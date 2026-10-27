import { API_BASE_URL } from "@/api/config";

export async function getPurchaseOrders() {
  const response = await fetch(`${API_BASE_URL}/purchase-orders`);

  if (!response.ok) {
    throw new Error("Failed to fetch purchase orders");
  }

  return response.json();
}

export async function getPurchaseOrderByNumber(poNumber: string) {
  const response = await fetch(
    `${API_BASE_URL}/purchase-orders?poNumber=${encodeURIComponent(poNumber)}`,
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
  const response = await fetch(`${API_BASE_URL}/purchase-orders/${id}`);

  if (!response.ok) {
    throw new Error("Failed to fetch purchase order");
  }

  return response.json();
}
