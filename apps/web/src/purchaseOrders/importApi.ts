// The purchase order import API calls. `send` is apiFetch in the app
// (src/api/purchaseOrders.ts), which adds the session cookie and the CSRF token;
// tests pass their own.
import type { ImportError, ImportRow } from "./importFile.ts";

type Send = (path: string, init?: RequestInit) => Promise<Response>;

export type ImportSummary = {
  purchaseOrders: number;
  items: number;
  rows: number;
  totalQuantity: number;
};

export type PreviewOrder = {
  poNumber: string;
  supplierCode: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  items: {
    articleNumber: string;
    productName: string;
    quantityOrdered: number;
    rowNumbers: number[];
  }[];
};

export type ValidationResult = {
  valid: boolean;
  summary: ImportSummary | null;
  orders: PreviewOrder[];
  errors: ImportError[];
};

export type ImportResult = {
  imported: { id: number; poNumber: string; items: number; totalQuantity: number }[];
  summary: ImportSummary;
};

// A failed request, with a message that can be shown to the user as is, and any
// row errors the API reported.
export class ImportRequestFailure extends Error {
  errors: ImportError[];

  constructor(message: string, errors: ImportError[] = []) {
    super(message);
    this.errors = errors;
  }
}

// Whether this result may lead to an import. The API checks everything again.
export function canImport(result: ValidationResult) {
  return result.valid === true && result.errors.length === 0 && result.orders.length > 0;
}

export function createPurchaseOrderImportApi(send: Send) {
  async function post(path: string, rows: ImportRow[], failure: string, unreachable: string) {
    let response: Response;

    try {
      response = await send(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
    } catch {
      throw new ImportRequestFailure(unreachable);
    }

    const result = (await response.json().catch(() => null)) as {
      error?: unknown;
      errors?: unknown;
    } | null;

    if (!response.ok) {
      throw new ImportRequestFailure(
        typeof result?.error === "string" ? result.error : failure,
        Array.isArray(result?.errors) ? (result.errors as ImportError[]) : [],
      );
    }

    if (!result) {
      throw new ImportRequestFailure(unreachable);
    }

    return result;
  }

  return {
    validate: async (rows: ImportRow[]) =>
      (await post(
        "/purchase-orders/import/validate",
        rows,
        "The file could not be validated",
        "The server could not be reached. Please try again.",
      )) as ValidationResult,

    // With no readable answer, the orders may have been saved.
    importRows: async (rows: ImportRow[]) =>
      (await post(
        "/purchase-orders/import",
        rows,
        "The purchase orders could not be imported",
        "The server gave no clear answer, so the import may or may not have been saved. Please check the purchase order list before trying again.",
      )) as ImportResult,
  };
}
