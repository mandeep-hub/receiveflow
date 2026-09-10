import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getPurchaseOrder } from "@/api/purchaseOrders";
import type { PurchaseOrder } from "@/types/purchaseOrder";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PurchaseOrderDetailsPage() {
  const { id } = useParams<{ id: string }>();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(
    null,
  );

  useEffect(() => {
    if (!id) {
      return;
    }

    getPurchaseOrder(Number(id)).then(setPurchaseOrder);
  }, [id]);

  if (!purchaseOrder) {
    return <p>Loading purchase order...</p>;
  }

  return (
    <div>
      <Link
        to="/purchase-orders"
        className="inline-block mb-6 text-sm font-medium hover:underline"
      >
        ← Back to Purchase Orders
      </Link>
      <h1 className="text-3xl font-bold">{purchaseOrder.poNumber}</h1>

      <p className="mt-2 text-muted-foreground">
        Purchase order details and items.
      </p>

      <div className="mt-6 grid gap-4 rounded-lg border p-6 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <p className="text-sm text-muted-foreground">Supplier</p>
          <p className="mt-1 font-medium">{purchaseOrder.supplier.name}</p>
        </div>

        <div>
          <p className="text-sm text-muted-foreground">Order Date</p>
          <p className="mt-1 font-medium">
            {new Date(purchaseOrder.orderDate).toLocaleDateString()}
          </p>
        </div>

        <div>
          <p className="text-sm text-muted-foreground">Expected Delivery</p>
          <p className="mt-1 font-medium">
            {new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString()}
          </p>
        </div>

        <div>
          <p className="text-sm text-muted-foreground">Status</p>
          <p className="mt-1 font-medium">{purchaseOrder.status}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Source</p>
          <p className="mt-1 font-medium">{purchaseOrder.source}</p>
        </div>
      </div>
      <h2 className="mt-8 text-xl font-semibold">Items</h2>

      <div className="mt-4 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article Number</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Quantity Ordered</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {purchaseOrder.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.product.articleNumber}</TableCell>
                <TableCell>{item.product.name}</TableCell>
                <TableCell>{item.quantityOrdered}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PurchaseOrderDetailsPage;
