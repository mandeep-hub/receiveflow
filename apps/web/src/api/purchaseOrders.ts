import { apiFetch } from "@/api/client";
import { createPurchaseOrderImportApi } from "@/purchaseOrders/importApi";

export const purchaseOrderImportApi = createPurchaseOrderImportApi(apiFetch);

export async function getPurchaseOrders() {
  const response = await apiFetch("/purchase-orders");

  if (!response.ok) {
    throw new Error("Failed to fetch purchase orders");
  }

  return response.json();
}

export async function getPurchaseOrderByNumber(poNumber: string) {
  const response = await apiFetch(
    `/purchase-orders?poNumber=${encodeURIComponent(poNumber)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to find purchase order");
  }

  const purchaseOrders = await response.json();

  return purchaseOrders.find(
    (purchaseOrder: { poNumber: string }) =>
      purchaseOrder.poNumber === poNumber,
  );
}

export async function getPurchaseOrder(id: number) {
  const response = await apiFetch(`/purchase-orders/${id}`);

  if (!response.ok) {
    throw new Error("Failed to fetch purchase order");
  }

  return response.json();
}
