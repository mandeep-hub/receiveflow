import { API_BASE_URL } from "@/api/config";

export type CreateReceivingItem = {
  purchaseOrderItemId: number;
  quantityReceived: number;
  reasonCode?: string | null;
  actionStatus?: string | null;
};

export type CreateReceivingRequest = {
  purchaseOrderId: number;
  epCount: number;
  items: CreateReceivingItem[];
};

// Exact error text of the API's 503 for POST /receivings when its
// transaction could not run and was rolled back. Must match the backend.
const API_BUSY_ERROR = "Receiving is busy, please try again";

// Why a save failed:
//   "rejected": the API answered and definitely did not save (4xx, or our
//               API's own "busy" 503, sent after its transaction rolled back);
//   "unknown":  no reliable answer (network failure, an unreadable reply, or
//               another server error), so the receiving MAY have been saved.
export class ReceivingRequestError extends Error {
  readonly outcome: "rejected" | "unknown";
  readonly status?: number;

  constructor(outcome: "rejected" | "unknown", message: string, status?: number) {
    super(message);
    this.name = "ReceivingRequestError";
    this.outcome = outcome;
    this.status = status;
  }
}

export async function createReceiving(data: CreateReceivingRequest) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/receivings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  } catch {
    throw new ReceivingRequestError("unknown", "No response was received from the server.");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.error || "Failed to save receiving";
    // A 503 is only a definite rejection when it is our API's own busy reply
    // (apps/api/src/app.ts). Any other 503, for example from a proxy that gave
    // up waiting, may come after the receiving was saved.
    const isApiBusyReply =
      response.status === 503 && errorData?.error === API_BUSY_ERROR;
    const definitelyNotSaved = response.status < 500 || isApiBusyReply;

    throw new ReceivingRequestError(
      definitelyNotSaved ? "rejected" : "unknown",
      message,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ReceivingRequestError(
      "unknown",
      "The server's reply could not be read.",
      response.status,
    );
  }
}
