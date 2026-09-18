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

export async function createReceiving(data: CreateReceivingRequest) {
  const response = await fetch("http://localhost:3000/receivings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(errorData?.error || "Failed to save receiving");
  }

  return response.json();
}
