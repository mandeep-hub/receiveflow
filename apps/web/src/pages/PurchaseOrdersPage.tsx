import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPurchaseOrders } from "@/api/purchaseOrders";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/date";
import PurchaseOrderImportDialog from "@/pages/PurchaseOrderImportDialog";
import { downloadImportTemplate } from "@/purchaseOrders/importFile";
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
  const { state } = useAuth();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [importing, setImporting] = useState(false);
  const [listError, setListError] = useState("");
  // This only hides the buttons: the API refuses non-ADMIN imports itself.
  const canImportOrders = state.status === "authenticated" && state.user.role === "ADMIN";

  useEffect(() => {
    getPurchaseOrders().then(setPurchaseOrders);
  }, []);

  async function reloadPurchaseOrders() {
    try {
      setPurchaseOrders(await getPurchaseOrders());
      setListError("");
    } catch {
      setListError("The purchase order list could not be refreshed. Please reload the page.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Purchase Orders</h1>

          <p className="mt-2 text-muted-foreground">
            View and manage incoming purchase orders.
          </p>
        </div>

        {canImportOrders && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={downloadImportTemplate}>
              Download template
            </Button>
            <Button type="button" onClick={() => setImporting(true)}>
              Import from Excel
            </Button>
          </div>
        )}
      </div>

      {listError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {listError}
        </p>
      )}

      {importing && (
        <PurchaseOrderImportDialog
          onClose={() => setImporting(false)}
          onListChanged={reloadPurchaseOrders}
        />
      )}

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

                <TableCell>{formatDate(purchaseOrder.orderDate)}</TableCell>

                <TableCell>
                  {formatDate(purchaseOrder.expectedDeliveryDate)}
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
