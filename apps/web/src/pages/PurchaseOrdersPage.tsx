import { useEffect, useState } from "react";
import { getPurchaseOrders } from "@/api/purchaseOrders";

function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  useEffect(() => {
    getPurchaseOrders().then(setPurchaseOrders);
  }, []);
  return (
    <div>
      <h1 className="text-3xl font-bold">Purchase Orders</h1>

      <p className="mt-2 text-muted-foreground">
        View and manage incoming purchase orders.
      </p>
      <p className="mt-6">Purchase orders loaded: {purchaseOrders.length}</p>
    </div>
  );
}

export default PurchaseOrdersPage;
