import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/api/config";
import { createReceiving, ReceivingRequestError } from "@/api/receivings";
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

type SaveMessageLine = {
  text: string;
  // The line needs the user's attention (something was not saved or is wrong).
  issue?: boolean;
  // The uncertain or skipped PO this line is about, so these lines can be
  // removed when the user confirms that its delivery was already saved.
  uncertainPoId?: number;
};

type SaveMessage = {
  kind: "success" | "error";
  lines: SaveMessageLine[];
};

const KEPT_ENTRIES_NOTE =
  "Entries of purchase orders that were not saved are kept. Purchase orders listed as saved have been cleared and will not be sent again.";

// The statuses the API accepts receivings for.
function isReceivable(purchaseOrder: PurchaseOrder) {
  return (
    purchaseOrder.status === "OPEN" ||
    purchaseOrder.status === "PARTIALLY_RECEIVED"
  );
}

// Why a PO whose save was uncertain is no longer in the table after a reload.
function closedPurchaseOrderText(
  poNumber: string,
  purchaseOrder: PurchaseOrder | undefined,
) {
  if (!purchaseOrder) {
    return `${poNumber} is no longer in the purchase order list, so it cannot be sent again.`;
  }

  if (purchaseOrder.status === "RECEIVED") {
    return `${poNumber} is now fully received, so it has been removed from the list and cannot be received again. The earlier save was most likely recorded; check the end-of-day report if you need to be sure.`;
  }

  return `${poNumber} is no longer open for receiving (status: ${purchaseOrder.status}), so it has been removed from the list and cannot be sent again.`;
}

// Fetch all purchase orders and the total already received per PO item.
async function fetchReceivingData() {
  const [purchaseOrdersResponse, receivingsResponse] = await Promise.all([
    fetch(`${API_BASE_URL}/purchase-orders`),
    fetch(`${API_BASE_URL}/receivings`),
  ]);

  if (!purchaseOrdersResponse.ok) {
    throw new Error("Failed to fetch purchase orders");
  }

  if (!receivingsResponse.ok) {
    throw new Error("Failed to fetch receiving history");
  }

  const purchaseOrders: PurchaseOrder[] = await purchaseOrdersResponse.json();
  const receivings: ReceivingHistory[] = await receivingsResponse.json();

  const previousReceived: Record<number, number> = {};

  for (const receiving of receivings) {
    for (const item of receiving.items) {
      previousReceived[item.purchaseOrderItemId] =
        (previousReceived[item.purchaseOrderItemId] ?? 0) +
        item.quantityReceived;
    }
  }

  return { purchaseOrders, previousReceived };
}

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

  // Result of the last save attempt, shown above the Save button.
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);

  // Validation messages per PO item id, shown under the Delivered input.
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});

  // Set synchronously when a save starts, so a second save can't start
  // before React has re-rendered the disabled button.
  const saveInFlight = useRef(false);

  // True when a reload failed after a save: the quantities on screen may be
  // out of date, so saving is paused until a reload succeeds.
  const [dataIsStale, setDataIsStale] = useState(false);
  const [reloading, setReloading] = useState(false);

  // POs whose last save had an uncertain outcome (it may already be saved).
  // They are skipped when saving until the user explicitly confirms that they
  // checked "Received so far" (the confirmation notice above the Save button).
  const [uncertainPoIds, setUncertainPoIds] = useState<number[]>([]);

  // Fetch all purchase orders and receiving history.
  useEffect(() => {
    async function fetchPurchaseOrders() {
      try {
        setLoading(true);
        setError("");

        const data = await fetchReceivingData();

        setPurchaseOrders(data.purchaseOrders);
        setPreviousReceivedByItem(data.previousReceived);
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
    const availablePurchaseOrders = purchaseOrders.filter(isReceivable);

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

    // Keep entries the user has not saved yet (for example on a PO whose save
    // failed) when the rows are rebuilt from freshly loaded data.
    setReceivingItems((current) => {
      const entered = new Map(current.map((row) => [row.id, row]));

      return rows.map((row) => {
        const previous = entered.get(row.id);

        return previous
          ? {
              ...row,
              quantityReceived: previous.quantityReceived,
              reasonCode: previous.reasonCode,
              actionStatus: previous.actionStatus,
            }
          : row;
      });
    });
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

    // The user is correcting this row, so its old message no longer applies.
    setItemErrors((current) => {
      if (!(itemId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  // Called only from the explicit buttons in the uncertain-PO notice
  // ("was not saved", "It was saved" or Dismiss); editing quantities never
  // unblocks a PO.
  function clearUncertain(purchaseOrderId: number) {
    setUncertainPoIds((current) =>
      current.includes(purchaseOrderId)
        ? current.filter((id) => id !== purchaseOrderId)
        : current,
    );
  }

  // The user checked "Received so far" and found that the uncertain delivery
  // was already recorded: discard this PO's unsent entries (quantities,
  // reasons, actions, EP Kasser and their error messages) and unblock it.
  // Only form state changes here; nothing is sent to the API.
  function clearSavedUncertain(purchaseOrderId: number, poNumber: string) {
    const poItemIds = new Set(
      receivingItems
        .filter((item) => item.purchaseOrderId === purchaseOrderId)
        .map((item) => item.id),
    );

    setReceivingItems((current) =>
      current.map((item) =>
        item.purchaseOrderId === purchaseOrderId
          ? { ...item, quantityReceived: null, reasonCode: "", actionStatus: "" }
          : item,
      ),
    );

    setEpCounts((current) => {
      const next = { ...current };
      delete next[purchaseOrderId];
      return next;
    });

    setItemErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([itemId]) => !poItemIds.has(Number(itemId))),
      ),
    );

    clearUncertain(purchaseOrderId);

    // Keep the rest of the last save message (for example which other POs
    // were saved), but drop this PO's uncertain/skipped lines, which no longer
    // apply. The "entries are kept" note and the error style remain only while
    // another issue is still listed.
    setSaveMessage((current) => {
      const remaining = (current?.lines ?? []).filter(
        (line) =>
          line.uncertainPoId !== purchaseOrderId && line.text !== KEPT_ENTRIES_NOTE,
      );
      const otherIssues = remaining.some((line) => line.issue);

      return {
        kind: otherIssues ? "error" : "success",
        lines: [
          ...remaining,
          {
            text: `${poNumber}: entries cleared. The earlier save was already recorded, so nothing was sent again.`,
          },
          ...(otherIssues ? [{ text: KEPT_ENTRIES_NOTE }] : []),
        ],
      };
    });
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

  // Same rules as the API: a whole number above 0, no more than what is
  // left, and a reason code when the delivery is short. Action is optional.
  function validateItem(item: ReceivingItemRow): string | null {
    const quantity = item.quantityReceived;

    if (quantity === null) {
      return null;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return "Enter a whole number greater than 0.";
    }

    const remaining = getRemainingQuantity(item);

    if (quantity > remaining) {
      return `Only ${remaining} left to receive.`;
    }

    if (quantity < remaining && !item.reasonCode) {
      return "Choose a reason code for a short delivery.";
    }

    return null;
  }

  // Reload POs and previous receivings without hiding the table. Only a
  // successful reload clears the stale-data flag. Returns the loaded data.
  async function reloadReceivingData() {
    const data = await fetchReceivingData();

    setPurchaseOrders(data.purchaseOrders);
    setPreviousReceivedByItem(data.previousReceived);
    setDataIsStale(false);

    return data;
  }

  // The "Reload data" button shown while data is stale.
  async function handleManualReload() {
    if (reloading) {
      return;
    }

    setReloading(true);

    try {
      await reloadReceivingData();
    } catch {
      // Still stale; the notice stays visible with its Reload button.
    } finally {
      setReloading(false);
    }
  }

  // Entry point for the Save button. The ref blocks a second save at once,
  // even before React has re-rendered with `saving` set.
  async function handleSaveReceiving() {
    if (saveInFlight.current || saving || dataIsStale) {
      return;
    }

    saveInFlight.current = true;

    try {
      await saveReceiving();
    } finally {
      saveInFlight.current = false;
    }
  }

  // Save one PO at a time. Each PO's entries are cleared as soon as it is
  // saved, so pressing Save again doesn't send that delivery a second time.
  async function saveReceiving() {
    setSaveMessage(null);

    const itemsWithDeliveredQuantity = filteredReceivingItems.filter(
      (item) => item.quantityReceived !== null,
    );

    if (itemsWithDeliveredQuantity.length === 0) {
      setSaveMessage({
        kind: "error",
        lines: [{ text: "Enter at least one delivered quantity.", issue: true }],
      });
      return;
    }

    // A PO whose last save had an uncertain outcome is skipped (not sent and
    // not validated) until the user has confirmed below that they checked its
    // "Received so far". All other POs are still saved.
    const skippedPoIds = [
      ...new Set(
        itemsWithDeliveredQuantity
          .filter((item) => uncertainPoIds.includes(item.purchaseOrderId))
          .map((item) => item.purchaseOrderId),
      ),
    ];

    const itemsToSave = itemsWithDeliveredQuantity.filter(
      (item) => !uncertainPoIds.includes(item.purchaseOrderId),
    );

    // One line per skipped PO, so each can be removed on its own later.
    const skippedLines: SaveMessageLine[] = skippedPoIds.map((purchaseOrderId) => ({
      text: `Skipped (not confirmed): ${
        itemsWithDeliveredQuantity.find((item) => item.purchaseOrderId === purchaseOrderId)
          ?.poNumber ?? String(purchaseOrderId)
      }. An earlier save may already have recorded this delivery, so it is only sent after you check "Received so far" and confirm below.`,
      issue: true,
      uncertainPoId: purchaseOrderId,
    }));

    if (itemsToSave.length === 0) {
      setItemErrors({});
      setSaveMessage({
        kind: "error",
        lines: [{ text: "Nothing was saved." }, ...skippedLines],
      });
      return;
    }

    // 1. Check everything that will be sent. Nothing is sent if any row is invalid.
    const errors: Record<number, string> = {};

    for (const item of itemsToSave) {
      const message = validateItem(item);

      if (message) {
        errors[item.id] = message;
      }
    }

    const purchaseOrderIds = [
      ...new Set(itemsToSave.map((item) => item.purchaseOrderId)),
    ];

    const epCountErrors = purchaseOrderIds
      .filter((purchaseOrderId) => {
        const epCount = epCounts[purchaseOrderId];
        return (
          epCount !== null &&
          epCount !== undefined &&
          (!Number.isInteger(epCount) || epCount < 0)
        );
      })
      .map((purchaseOrderId) => {
        const poNumber = itemsToSave.find(
          (item) => item.purchaseOrderId === purchaseOrderId,
        )?.poNumber;
        return `${poNumber}: EP Kasser must be a whole number of 0 or more.`;
      });

    setItemErrors(errors);

    if (Object.keys(errors).length > 0 || epCountErrors.length > 0) {
      setSaveMessage({
        kind: "error",
        lines: [
          { text: "Nothing was saved. Please correct the highlighted rows.", issue: true },
          ...epCountErrors.map((text) => ({ text, issue: true })),
          ...skippedLines,
        ],
      });
      return;
    }

    // 2. Save PO by PO, stopping at the first failure.
    const savedPoNumbers: string[] = [];
    let failure: {
      purchaseOrderId: number;
      poNumber: string;
      message: string;
      uncertain: boolean;
    } | null = null;
    let notAttempted: string[] = [];

    setSaving(true);

    try {
      for (const [index, purchaseOrderId] of purchaseOrderIds.entries()) {
        const poItems = itemsToSave.filter(
          (item) => item.purchaseOrderId === purchaseOrderId,
        );
        const poNumber = poItems[0].poNumber;
        const poItemIds = new Set(poItems.map((item) => item.id));

        try {
          await createReceiving({
            purchaseOrderId,
            epCount: epCounts[purchaseOrderId] ?? 0,
            items: poItems.map((item) => ({
              purchaseOrderItemId: item.id,
              quantityReceived: item.quantityReceived!,
              reasonCode: item.reasonCode || null,
              actionStatus: item.actionStatus || null,
            })),
          });
        } catch (err) {
          // Anything other than a definite rejection is treated as uncertain.
          failure = {
            purchaseOrderId,
            poNumber,
            message: err instanceof Error ? err.message : "Failed to save receiving.",
            uncertain: !(err instanceof ReceivingRequestError) || err.outcome === "unknown",
          };
          notAttempted = purchaseOrderIds
            .slice(index + 1)
            .map(
              (id) =>
                itemsToSave.find((item) => item.purchaseOrderId === id)
                  ?.poNumber ?? String(id),
            );
          break;
        }

        // Saved: clear this PO's entries straight away.
        savedPoNumbers.push(poNumber);

        setReceivingItems((current) =>
          current.map((item) =>
            poItemIds.has(item.id)
              ? { ...item, quantityReceived: null, reasonCode: "", actionStatus: "" }
              : item,
          ),
        );

        setEpCounts((current) => {
          const next = { ...current };
          delete next[purchaseOrderId];
          return next;
        });
      }

      // An uncertain PO is skipped by later saves until the user explicitly
      // confirms in the notice below whether it was saved; changing a delivered
      // quantity does not unblock it.
      if (failure?.uncertain) {
        const uncertainId = failure.purchaseOrderId;
        setUncertainPoIds((current) =>
          current.includes(uncertainId) ? current : [...current, uncertainId],
        );
      }

      // 3. Reload so received quantities and statuses are current: after any
      //    successful save, and after an uncertain one (it may have been saved).
      //    No automatic retry of the save itself.
      let reloadFailed = false;
      let reloaded: Awaited<ReturnType<typeof fetchReceivingData>> | null = null;

      if (savedPoNumbers.length > 0 || failure?.uncertain) {
        try {
          reloaded = await reloadReceivingData();
        } catch {
          reloadFailed = true;
          setDataIsStale(true);
        }
      }

      const lines: SaveMessageLine[] = [];

      if (savedPoNumbers.length > 0) {
        lines.push({ text: `Saved: ${savedPoNumbers.join(", ")}.` });
      }

      if (failure && !failure.uncertain) {
        lines.push({
          text: `Not saved: ${failure.poNumber}. ${failure.message}`,
          issue: true,
        });
      }

      if (failure?.uncertain) {
        const uncertainId = failure.purchaseOrderId;
        const latest = reloaded?.purchaseOrders.find(
          (purchaseOrder) => purchaseOrder.id === uncertainId,
        );

        lines.push(
          {
            text: `Uncertain: ${failure.poNumber}. The result of this save is unknown (${failure.message}). It may already have been saved.`,
            issue: true,
            uncertainPoId: uncertainId,
          },
          {
            text: reloadFailed
              ? `Its entries are kept. It will not be sent again until the data has been reloaded and you have confirmed below that you checked its "Received so far".`
              : latest && isReceivable(latest)
                ? `The latest data has been reloaded. Check its "Received so far" against the delivery. It will not be sent again until you confirm below.`
                : closedPurchaseOrderText(failure.poNumber, latest),
            issue: true,
            uncertainPoId: uncertainId,
          },
        );
      }

      if (failure && notAttempted.length > 0) {
        lines.push({ text: `Not attempted: ${notAttempted.join(", ")}.`, issue: true });
      }

      lines.push(...skippedLines);

      if (failure || skippedLines.length > 0) {
        lines.push({ text: KEPT_ENTRIES_NOTE });
      }

      setSaveMessage({
        kind: failure || reloadFailed || skippedLines.length > 0 ? "error" : "success",
        lines,
      });
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
                              Received so far
                            </th>

                            <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                              Remaining
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
                                      disabled={saving}
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

                                {/* Received so far */}
                                <td className="px-3 py-2 text-right">
                                  {item.previouslyReceived}
                                </td>

                                {/* Remaining */}
                                <td className="px-3 py-2 text-right">
                                  {getRemainingQuantity(item)}
                                </td>

                                {/* Delivered */}
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={saving}
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
                                    aria-invalid={Boolean(itemErrors[item.id])}
                                    className={`h-9 w-24 rounded-md border bg-background px-2 text-right text-sm ${
                                      itemErrors[item.id] ? "border-destructive" : ""
                                    }`}
                                  />

                                  {itemErrors[item.id] && (
                                    <p className="mt-1 max-w-40 text-xs text-destructive">
                                      {itemErrors[item.id]}
                                    </p>
                                  )}
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
                                    disabled={saving}
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
                                  {/* Optional, as in the API. */}
                                  <select
                                    value={item.actionStatus}
                                    disabled={saving}
                                    onChange={(event) =>
                                      updateItem(
                                        item.id,
                                        "actionStatus",
                                        event.target.value,
                                      )
                                    }
                                    className="h-9 min-w-40 rounded-md border bg-background px-2 text-sm"
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

              {/* Result of the last save attempt */}
              {saveMessage && (
                <div
                  role={saveMessage.kind === "error" ? "alert" : "status"}
                  className={`mt-4 rounded-md border p-4 text-sm ${
                    saveMessage.kind === "error"
                      ? "border-destructive text-destructive"
                      : "border-green-600 text-green-700"
                  }`}
                >
                  {saveMessage.lines.map((line) => (
                    <p key={line.text}>{line.text}</p>
                  ))}
                </div>
              )}

              {/* Saving is paused while the quantities on screen may be out of date */}
              {dataIsStale && (
                <div
                  role="alert"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive p-4 text-sm text-destructive"
                >
                  <p>
                    The latest quantities could not be loaded, so the numbers on
                    screen may be out of date. Saving is paused until they are
                    reloaded.
                  </p>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleManualReload}
                    disabled={reloading}
                  >
                    {reloading ? "Reloading..." : "Reload data"}
                  </Button>
                </div>
              )}

              {/* POs whose last save was uncertain: sent again only after an explicit confirmation */}
              {uncertainPoIds.length > 0 && (
                <div
                  role="alert"
                  className="mt-4 space-y-4 rounded-md border border-destructive p-4 text-sm text-destructive"
                >
                  {uncertainPoIds.map((purchaseOrderId) => {
                    const purchaseOrder = purchaseOrders.find(
                      (po) => po.id === purchaseOrderId,
                    );
                    const poNumber =
                      purchaseOrder?.poNumber ?? `Purchase order ${purchaseOrderId}`;

                    // Not receivable any more (for example fully received):
                    // nothing can be sent, so only explain and allow dismissing.
                    if (!purchaseOrder || !isReceivable(purchaseOrder)) {
                      return (
                        <div
                          key={purchaseOrderId}
                          className="flex flex-wrap items-center justify-between gap-3"
                        >
                          <p>{closedPurchaseOrderText(poNumber, purchaseOrder)}</p>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => clearUncertain(purchaseOrderId)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      );
                    }

                    return (
                      <div key={purchaseOrderId} className="space-y-2">
                        <p>
                          {poNumber}: the last save may already have been
                          recorded, even though no confirmation was received.
                          Check its "Received so far" column against the
                          delivery. If the delivery is already included there,
                          choose "It was saved – clear these entries". Only
                          allow sending it again if it is not included;
                          otherwise it would be recorded twice.
                        </p>

                        {dataIsStale && (
                          <p>
                            Reload the data first: the "Received so far" numbers
                            on screen may be out of date.
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              clearSavedUncertain(purchaseOrderId, poNumber)
                            }
                            disabled={saving || dataIsStale}
                          >
                            It was saved – clear these entries
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => clearUncertain(purchaseOrderId)}
                            disabled={saving || dataIsStale}
                          >
                            I checked "Received so far" – {poNumber} was not
                            saved, allow sending it again
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Save */}
              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  onClick={handleSaveReceiving}
                  disabled={
                    filteredReceivingItems.length === 0 || saving || dataIsStale
                  }
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
