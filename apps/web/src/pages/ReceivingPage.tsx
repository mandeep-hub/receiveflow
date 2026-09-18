import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { createReceiving } from "@/api/receivings";
import type { PurchaseOrder } from "@/types/purchaseOrder";

type ReceivingItemRow = {
  id: number;
  purchaseOrderId: number;
  poNumber: string;
  supplierName: string;
  articleNumber: string;
  productName: string;
  quantityOrdered: number;
  previouslyReceived: number;
  quantityReceived: number | null;
  reasonCode: string;
  actionStatus: string;
};

type ReceivingHistory = {
  purchaseOrderId: number;
  items: {
    purchaseOrderItemId: number;
    quantityReceived: number;
  }[];
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
  const [saving, setSaving] = useState(false);

  const [entryMode, setEntryMode] = useState<"manual" | "import">("manual");

  // EP Kasser count per PO.
  // null means that the employee has not entered a value yet.
  const [epCounts, setEpCounts] = useState<Record<number, number | null>>({});

  const [receivingItems, setReceivingItems] = useState<ReceivingItemRow[]>([]);

  // Total quantity already received for each PO item.
  const [previousReceivedByItem, setPreviousReceivedByItem] = useState<
    Record<number, number>
  >({});

  // Fetch all purchase orders and receiving history.
  useEffect(() => {
    async function fetchPurchaseOrders() {
      try {
        setLoading(true);
        setError("");

        const [purchaseOrdersResponse, receivingsResponse] = await Promise.all([
          fetch("http://localhost:3000/purchase-orders"),
          fetch("http://localhost:3000/receivings"),
        ]);

        if (!purchaseOrdersResponse.ok) {
          throw new Error("Failed to fetch purchase orders");
        }

        if (!receivingsResponse.ok) {
          throw new Error("Failed to fetch receiving history");
        }

        const purchaseOrdersData: PurchaseOrder[] =
          await purchaseOrdersResponse.json();

        const receivingsData: ReceivingHistory[] =
          await receivingsResponse.json();

        const previousReceived: Record<number, number> = {};

        for (const receiving of receivingsData) {
          for (const item of receiving.items) {
            previousReceived[item.purchaseOrderItemId] =
              (previousReceived[item.purchaseOrderItemId] ?? 0) +
              item.quantityReceived;
          }
        }

        setPurchaseOrders(purchaseOrdersData);
        setPreviousReceivedByItem(previousReceived);
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

  // Create receiving rows from all available PO items.
  useEffect(() => {
    const availablePurchaseOrders = purchaseOrders.filter(
      (purchaseOrder) =>
        purchaseOrder.status === "OPEN" ||
        purchaseOrder.status === "PARTIALLY_RECEIVED",
    );

    const rows: ReceivingItemRow[] = availablePurchaseOrders.flatMap(
      (purchaseOrder) =>
        purchaseOrder.items.map((item) => ({
          id: item.id,
          purchaseOrderId: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          supplierName: purchaseOrder.supplier.name,
          articleNumber: item.product.articleNumber,
          productName: item.product.name,
          quantityOrdered: item.quantityOrdered,
          previouslyReceived: previousReceivedByItem[item.id] ?? 0,
          quantityReceived: null,
          reasonCode: "",
          actionStatus: "",
        })),
    );

    setReceivingItems(rows);
  }, [purchaseOrders, previousReceivedByItem]);

  // Filter rows based on PO search.
  const filteredReceivingItems = useMemo(() => {
    const search = searchPo.trim().toLowerCase();

    if (!search) {
      return receivingItems;
    }

    return receivingItems.filter((item) =>
      item.poNumber.toLowerCase().includes(search),
    );
  }, [receivingItems, searchPo]);

  // Check whether at least one delivered quantity has been entered.
  const hasDeliveredQuantity = filteredReceivingItems.some(
    (item) => item.quantityReceived !== null,
  );

  // Calculate totals.
  const totalOrdered = filteredReceivingItems.reduce(
    (total, item) => total + item.quantityOrdered,
    0,
  );

  const totalDelivered = filteredReceivingItems.reduce(
    (total, item) => total + (item.quantityReceived ?? 0),
    0,
  );

  const totalDifference = totalDelivered - totalOrdered;

  // Update delivered quantity / reason / action.
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

  // Update EP Kasser for a PO.
  function updateEpCount(purchaseOrderId: number, value: string) {
    const numericValue = value.trim() === "" ? null : Number(value);

    setEpCounts((current) => ({
      ...current,
      [purchaseOrderId]: numericValue,
    }));
  }

  function getRemainingQuantity(item: ReceivingItemRow) {
    return Math.max(item.quantityOrdered - item.previouslyReceived, 0);
  }

  function getDifference(item: ReceivingItemRow) {
    if (item.quantityReceived === null) {
      return null;
    }

    const remainingQuantity = getRemainingQuantity(item);

    return item.quantityReceived - remainingQuantity;
  }

  // Validate before saving.
  async function handleSaveReceiving() {
    if (saving) {
      return;
    }

    const invalidItems = filteredReceivingItems.filter((item) => {
      const difference = getDifference(item);

      if (difference === null) {
        return false;
      }

      if (difference < 0) {
        return !item.reasonCode || !item.actionStatus;
      }

      return false;
    });

    if (invalidItems.length > 0) {
      alert(
        "Please select a Reason Code and Action Required for all items with a negative difference.",
      );
      return;
    }

    const itemsWithDeliveredQuantity = filteredReceivingItems.filter(
      (item) => item.quantityReceived !== null,
    );

    if (itemsWithDeliveredQuantity.length === 0) {
      alert("Please enter at least one delivered quantity.");
      return;
    }

    try {
      setSaving(true);

      const purchaseOrderIds = [
        ...new Set(
          itemsWithDeliveredQuantity.map((item) => item.purchaseOrderId),
        ),
      ];

      for (const purchaseOrderId of purchaseOrderIds) {
        const poItems = itemsWithDeliveredQuantity.filter(
          (item) => item.purchaseOrderId === purchaseOrderId,
        );

        const epCount = epCounts[purchaseOrderId] ?? 0;

        await createReceiving({
          purchaseOrderId,
          epCount,
          items: poItems.map((item) => ({
            purchaseOrderItemId: item.id,
            quantityReceived: item.quantityReceived!,
            reasonCode: item.reasonCode || null,
            actionStatus: item.actionStatus || null,
          })),
        });
      }

      alert("Receiving saved successfully.");

      setReceivingItems((current) =>
        current.map((item) => ({
          ...item,
          quantityReceived: null,
          reasonCode: "",
          actionStatus: "",
        })),
      );

      setEpCounts({});
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save receiving.");
    } finally {
      setSaving(false);
    }
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
                  <div>
                    <h2 className="text-lg font-semibold">All Available POs</h2>

                    <p className="text-sm text-muted-foreground">
                      Only open and partially received purchase orders are
                      shown.
                    </p>
                  </div>

                  <span className="text-sm text-muted-foreground">
                    Showing {filteredReceivingItems.length} of{" "}
                    {receivingItems.length} items
                  </span>
                </div>

                {filteredReceivingItems.length === 0 ? (
                  <div className="p-12 text-center">
                    {receivingItems.length === 0 ? (
                      <>
                        <p className="font-medium">
                          No purchase orders available for receiving.
                        </p>

                        <p className="mt-2 text-sm text-muted-foreground">
                          All current purchase orders have been fully received
                          or are not ready for receiving.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">
                          No matching purchase order found.
                        </p>

                        <p className="mt-2 text-sm text-muted-foreground">
                          Try searching with a different PO number.
                        </p>
                      </>
                    )}
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
                  disabled={filteredReceivingItems.length === 0 || saving}
                >
                  {saving ? "Saving..." : "Save Receiving"}
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
