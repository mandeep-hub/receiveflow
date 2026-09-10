import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPurchaseOrders } from "@/api/purchaseOrders";
import type { PurchaseOrder } from "@/types/purchaseOrder";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    getPurchaseOrders().then(setPurchaseOrders);
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold">Purchase Orders</h1>

      <p className="mt-2 text-muted-foreground">
        View and manage incoming purchase orders.
      </p>

      <div className="mt-6 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO Number</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Order Date</TableHead>
              <TableHead>Expected Delivery</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Items</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {purchaseOrders.map((purchaseOrder) => (
              <TableRow key={purchaseOrder.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/purchase-orders/${purchaseOrder.id}`}
                    className="hover:underline"
                  >
                    {purchaseOrder.poNumber}
                  </Link>
                </TableCell>
                <TableCell>{purchaseOrder.supplier.name}</TableCell>

                <TableCell>
                  {new Date(purchaseOrder.orderDate).toLocaleDateString()}
                </TableCell>

                <TableCell>
                  {new Date(
                    purchaseOrder.expectedDeliveryDate,
                  ).toLocaleDateString()}
                </TableCell>

                <TableCell>{purchaseOrder.status}</TableCell>

                <TableCell>{purchaseOrder.items.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PurchaseOrdersPage;
