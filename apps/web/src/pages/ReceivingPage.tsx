import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PurchaseOrder } from "@/types/purchaseOrder";

type ReceivingItemRow = {
  id: number;
  purchaseOrderId: number;
  poNumber: string;
  supplierName: string;
  articleNumber: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number | null;
  reasonCode: string;
  actionStatus: string;
};

const reasonCodes = [
  { value: "", label: "—" },
  { value: "MISSING_ITEM", label: "Missing Item" },
  { value: "PARTIAL_DELIVERY", label: "Partial Delivery" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "QUALITY_ISSUE", label: "Quality Issue" },
  { value: "NO_LABEL", label: "No Label" },
  {
    value: "QUALITY_ISSUE_AFTER_RECEIVING",
    label: "Quality Issue After Receiving",
  },
  { value: "OTHER", label: "Other" },
];

const actionStatuses = [
  { value: "", label: "—" },
  { value: "FOLLOW_UP", label: "Follow Up" },
  { value: "CREDIT_REQUEST", label: "Credit Request" },
  { value: "REPLACEMENT_REQUEST", label: "Replacement Request" },
  { value: "RETURNED_TO_SUPPLIER", label: "Returned to Supplier" },
  { value: "NO_ACTION", label: "No Action" },
];

function ReceivingPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchPo, setSearchPo] = useState("");

  const [entryMode, setEntryMode] = useState<"manual" | "import">("manual");

  // EP Kasser count per PO.
  // null means that the employee has not entered a value yet.
  const [epCounts, setEpCounts] = useState<Record<number, number | null>>({});

  const [receivingItems, setReceivingItems] = useState<ReceivingItemRow[]>([]);

  // Fetch all available purchase orders
  useEffect(() => {
    async function fetchPurchaseOrders() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("http://localhost:3000/purchase-orders");

        if (!response.ok) {
          throw new Error("Failed to fetch purchase orders");
        }

        const data: PurchaseOrder[] = await response.json();

        setPurchaseOrders(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch purchase orders",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchPurchaseOrders();
  }, []);

  // Create receiving rows from all PO items
  useEffect(() => {
    const rows: ReceivingItemRow[] = purchaseOrders.flatMap((purchaseOrder) =>
      purchaseOrder.items.map((item) => ({
        id: item.id,
        purchaseOrderId: purchaseOrder.id,
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplier.name,
        articleNumber: item.product.articleNumber,
        productName: item.product.name,
        quantityOrdered: item.quantityOrdered,
        quantityReceived: null,
        reasonCode: "",
        actionStatus: "",
      })),
    );

    setReceivingItems(rows);
  }, [purchaseOrders]);

  // Filter rows based on PO search
  const filteredReceivingItems = useMemo(() => {
    const search = searchPo.trim().toLowerCase();

    if (!search) {
      return receivingItems;
    }

    return receivingItems.filter((item) =>
      item.poNumber.toLowerCase().includes(search),
    );
  }, [receivingItems, searchPo]);

  // Check whether at least one delivered quantity has been entered
  const hasDeliveredQuantity = filteredReceivingItems.some(
    (item) => item.quantityReceived !== null,
  );

  // Calculate totals
  const totalOrdered = filteredReceivingItems.reduce(
    (total, item) => total + item.quantityOrdered,
    0,
  );

  const totalDelivered = filteredReceivingItems.reduce(
    (total, item) => total + (item.quantityReceived ?? 0),
    0,
  );

  const totalDifference = totalDelivered - totalOrdered;

  // Update delivered quantity / reason / action
  function updateItem(
    itemId: number,
    field: keyof ReceivingItemRow,
    value: string | number | null,
  ) {
    setReceivingItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    );
  }

  // Update EP Kasser for a PO
  function updateEpCount(purchaseOrderId: number, value: string) {
    const numericValue = value.trim() === "" ? null : Number(value);

    setEpCounts((current) => ({
      ...current,
      [purchaseOrderId]: numericValue,
    }));
  }

  function getDifference(item: ReceivingItemRow) {
    if (item.quantityReceived === null) {
      return null;
    }

    return item.quantityReceived - item.quantityOrdered;
  }

  // Validate before saving
  function handleSaveReceiving() {
    const invalidItems = filteredReceivingItems.filter((item) => {
      const difference = getDifference(item);

      // Delivered has not been entered yet.
      if (difference === null) {
        return false;
      }

      // Only a negative difference requires
      // Reason Code and Action Required.
      if (difference < 0) {
        return !item.reasonCode || !item.actionStatus;
      }

      // Zero and positive differences are optional.
      return false;
    });

    if (invalidItems.length > 0) {
      alert(
        "Please select a Reason Code and Action Required for all items with a negative difference.",
      );
      return;
    }

    // API connection will be added later.
    console.log("Receiving items:", filteredReceivingItems);
    console.log("EP Kasser:", epCounts);
  }

  return (
    <div>
      {/* Loading */}
      {loading && (
        <p className="mt-4 text-sm text-muted-foreground">
          Loading purchase orders...
        </p>
      )}

      {/* Error */}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <>
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold">Receiving</h1>

            {/* Search / Scan PO */}
            <div className="mt-6">
              <label
                htmlFor="search-po"
                className="mb-2 block text-sm font-medium"
              >
                Search / Scan PO
              </label>

              <input
                id="search-po"
                type="text"
                value={searchPo}
                onChange={(event) => setSearchPo(event.target.value)}
                placeholder="Enter or scan PO number..."
                className="w-full rounded-md border px-3 py-2"
                autoFocus
              />

              <p className="mt-2 text-sm text-muted-foreground">
                Scan a PO number or use search to filter the list. Enter
                delivery quantities and discrepancies directly in the table.
              </p>
            </div>
          </div>

          {/* Entry Mode */}
          <div className="mt-6 inline-flex rounded-md border p-1">
            <Button
              type="button"
              variant={entryMode === "manual" ? "default" : "ghost"}
              onClick={() => setEntryMode("manual")}
            >
              Manual Entry
            </Button>

            <Button
              type="button"
              variant={entryMode === "import" ? "default" : "ghost"}
              onClick={() => setEntryMode("import")}
            >
              Excel / Qlik Import
            </Button>
          </div>

          {/* Manual Entry */}
          {entryMode === "manual" && (
            <div className="mt-8">
              <div className="rounded-lg border bg-background">
                {/* Table Header */}
                <div className="flex items-center justify-between border-b p-4">
                  <h2 className="text-lg font-semibold">All Available POs</h2>

                  <span className="text-sm text-muted-foreground">
                    Showing {filteredReceivingItems.length} of{" "}
                    {receivingItems.length} items
                  </span>
                </div>

                {filteredReceivingItems.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-muted-foreground">
                      No matching purchase order found.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Receiving Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              PO Number
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              Supplier
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-center font-medium">
                              EP Kasser
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              Article
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              Product
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                              Ordered
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                              Delivered
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                              Difference
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              Reason Code
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                              Action Required
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {filteredReceivingItems.map((item, index) => {
                            const difference = getDifference(item);

                            const previousItem =
                              filteredReceivingItems[index - 1];

                            const isFirstRowOfPo =
                              !previousItem ||
                              previousItem.purchaseOrderId !==
                                item.purchaseOrderId;

                            const discrepancyRequiresReason =
                              difference !== null && difference < 0;

                            return (
                              <tr
                                key={item.id}
                                className="border-b last:border-0 hover:bg-muted/30"
                              >
                                {/* PO Number */}
                                <td className="whitespace-nowrap px-3 py-2 font-medium">
                                  {isFirstRowOfPo ? item.poNumber : ""}
                                </td>

                                {/* Supplier */}
                                <td className="whitespace-nowrap px-3 py-2">
                                  {isFirstRowOfPo ? item.supplierName : ""}
                                </td>

                                {/* EP Kasser */}
                                <td className="px-3 py-2 text-center">
                                  {isFirstRowOfPo ? (
                                    <input
                                      type="number"
                                      min="0"
                                      value={
                                        epCounts[item.purchaseOrderId] ?? ""
                                      }
                                      onChange={(event) =>
                                        updateEpCount(
                                          item.purchaseOrderId,
                                          event.target.value,
                                        )
                                      }
                                      className="h-9 w-20 rounded-md border bg-background px-2 text-center text-sm"
                                    />
                                  ) : null}
                                </td>

                                {/* Article */}
                                <td className="whitespace-nowrap px-3 py-2">
                                  {item.articleNumber}
                                </td>

                                {/* Product */}
                                <td className="px-3 py-2">
                                  {item.productName}
                                </td>

                                {/* Ordered */}
                                <td className="px-3 py-2 text-right">
                                  {item.quantityOrdered}
                                </td>

                                {/* Delivered */}
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.quantityReceived ?? ""}
                                    onChange={(event) =>
                                      updateItem(
                                        item.id,
                                        "quantityReceived",
                                        event.target.value === ""
                                          ? null
                                          : Number(event.target.value),
                                      )
                                    }
                                    className="h-9 w-24 rounded-md border bg-background px-2 text-right text-sm"
                                  />
                                </td>

                                {/* Difference */}
                                <td
                                  className={`px-3 py-2 text-right font-semibold ${
                                    difference === null
                                      ? "text-muted-foreground"
                                      : difference < 0
                                        ? "text-destructive"
                                        : difference > 0
                                          ? "text-green-600"
                                          : "text-muted-foreground"
                                  }`}
                                >
                                  {difference === null
                                    ? ""
                                    : difference > 0
                                      ? `+${difference}`
                                      : difference}
                                </td>

                                {/* Reason Code */}
                                <td className="px-3 py-2">
                                  <select
                                    value={item.reasonCode}
                                    required={discrepancyRequiresReason}
                                    onChange={(event) =>
                                      updateItem(
                                        item.id,
                                        "reasonCode",
                                        event.target.value,
                                      )
                                    }
                                    className={`h-9 min-w-40 rounded-md border bg-background px-2 text-sm ${
                                      discrepancyRequiresReason &&
                                      !item.reasonCode
                                        ? "border-destructive"
                                        : ""
                                    }`}
                                  >
                                    {reasonCodes.map((reason) => (
                                      <option
                                        key={reason.value}
                                        value={reason.value}
                                      >
                                        {reason.label}
                                      </option>
                                    ))}
                                  </select>

                                  {discrepancyRequiresReason &&
                                    !item.reasonCode && (
                                      <p className="mt-1 text-xs text-destructive">
                                        Required
                                      </p>
                                    )}
                                </td>

                                {/* Action Required */}
                                <td className="px-3 py-2">
                                  <select
                                    value={item.actionStatus}
                                    required={discrepancyRequiresReason}
                                    onChange={(event) =>
                                      updateItem(
                                        item.id,
                                        "actionStatus",
                                        event.target.value,
                                      )
                                    }
                                    className={`h-9 min-w-40 rounded-md border bg-background px-2 text-sm ${
                                      discrepancyRequiresReason &&
                                      !item.actionStatus
                                        ? "border-destructive"
                                        : ""
                                    }`}
                                  >
                                    {actionStatuses.map((action) => (
                                      <option
                                        key={action.value}
                                        value={action.value}
                                      >
                                        {action.label}
                                      </option>
                                    ))}
                                  </select>

                                  {discrepancyRequiresReason &&
                                    !item.actionStatus && (
                                      <p className="mt-1 text-xs text-destructive">
                                        Required
                                      </p>
                                    )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals */}
                    <div className="grid border-t md:grid-cols-3">
                      <div className="border-b p-4 md:border-b-0 md:border-r">
                        <p className="text-sm text-muted-foreground">
                          Total Ordered
                        </p>

                        <p className="mt-1 text-2xl font-bold">
                          {totalOrdered}
                        </p>
                      </div>

                      <div className="border-b p-4 md:border-b-0 md:border-r">
                        <p className="text-sm text-muted-foreground">
                          Total Delivered
                        </p>

                        <p className="mt-1 text-2xl font-bold">
                          {hasDeliveredQuantity ? totalDelivered : "—"}
                        </p>
                      </div>

                      <div className="p-4">
                        <p className="text-sm text-muted-foreground">
                          Total Difference
                        </p>

                        <p
                          className={`mt-1 text-2xl font-bold ${
                            !hasDeliveredQuantity
                              ? "text-muted-foreground"
                              : totalDifference < 0
                                ? "text-destructive"
                                : totalDifference > 0
                                  ? "text-green-600"
                                  : ""
                          }`}
                        >
                          {hasDeliveredQuantity
                            ? totalDifference > 0
                              ? `+${totalDifference}`
                              : totalDifference
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Save */}
              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  onClick={handleSaveReceiving}
                  disabled={filteredReceivingItems.length === 0}
                >
                  Save Receiving
                </Button>
              </div>
            </div>
          )}

          {/* Excel / Qlik Import */}
          {entryMode === "import" && (
            <div className="mt-8 rounded-lg border border-dashed p-12 text-center">
              <h2 className="text-lg font-semibold">Excel / Qlik Import</h2>

              <p className="mt-2 text-sm text-muted-foreground">
                Import functionality will be connected later.
              </p>

              <Button type="button" className="mt-4">
                Choose Excel File
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ReceivingPage;
