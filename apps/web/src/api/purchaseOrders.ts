export async function getPurchaseOrders() {
  const response = await fetch("http://localhost:3000/purchase-orders");

  if (!response.ok) {
    throw new Error("Failed to fetch purchase orders");
  }

  return response.json();
}

export async function getPurchaseOrder(id: number) {
  const response = await fetch(`http://localhost:3000/purchase-orders/${id}`);

  if (!response.ok) {
    throw new Error("Failed to fetch purchase order");
  }

  return response.json();
}
