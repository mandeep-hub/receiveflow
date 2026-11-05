import { useState, type ChangeEvent } from "react";

import { purchaseOrderImportApi } from "@/api/purchaseOrders";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import {
  canImport,
  ImportRequestFailure,
  type ImportResult,
  type ImportSummary,
  type ValidationResult,
} from "@/purchaseOrders/importApi";
import {
  fileProblem,
  ImportFileError,
  MAX_DATA_ROWS,
  readImportFile,
  type ImportError,
  type ImportRow,
} from "@/purchaseOrders/importFile";

type Step =
  | { kind: "pick"; message: string }
  | { kind: "busy"; label: string }
  | { kind: "errors"; errors: ImportError[] }
  | { kind: "preview"; rows: ImportRow[]; validation: ValidationResult }
  | { kind: "confirm"; rows: ImportRow[]; validation: ValidationResult }
  | { kind: "done"; result: ImportResult };

type Props = {
  onClose: () => void;
  onListChanged: () => Promise<void>;
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function totals(summary: ImportSummary) {
  return `${plural(summary.purchaseOrders, "purchase order")}, ${plural(summary.items, "item")}, total quantity ${summary.totalQuantity}.`;
}

function PurchaseOrderImportDialog({ onClose, onListChanged }: Props) {
  const [step, setStep] = useState<Step>({ kind: "pick", message: "" });
  const busy = step.kind === "busy";

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const problem = fileProblem(file.name, file.size);

    if (problem) {
      event.target.value = "";
      setStep({ kind: "pick", message: problem });
      return;
    }

    setStep({ kind: "busy", label: "Checking the file..." });

    try {
      const { rows, errors } = readImportFile(await file.arrayBuffer());

      if (errors.length > 0) {
        setStep({ kind: "errors", errors });
        return;
      }

      const validation = await purchaseOrderImportApi.validate(rows);

      setStep(
        canImport(validation)
          ? { kind: "preview", rows, validation }
          : { kind: "errors", errors: validation.errors },
      );
    } catch (error) {
      setStep({
        kind: "pick",
        message:
          error instanceof ImportFileError || error instanceof ImportRequestFailure
            ? error.message
            : "The file could not be checked. Please try again.",
      });
    }
  }

  async function handleImport(rows: ImportRow[]) {
    setStep({ kind: "busy", label: "Importing..." });

    try {
      setStep({ kind: "done", result: await purchaseOrderImportApi.importRows(rows) });
    } catch (error) {
      if (error instanceof ImportRequestFailure && error.errors.length > 0) {
        setStep({ kind: "errors", errors: error.errors });
      } else {
        // The file is checked again from the start before another attempt.
        setStep({
          kind: "pick",
          message:
            error instanceof ImportRequestFailure
              ? error.message
              : "The import could not be finished. Please check the purchase order list before trying again.",
        });
      }
    }

    await onListChanged();
  }

  const startAgain = () => setStep({ kind: "pick", message: "" });

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Import purchase orders</DialogTitle>

        {step.kind === "pick" && (
          <>
            <DialogDescription>
              Choose an .xlsx file made from the template, with at most {MAX_DATA_ROWS} data rows.
              It is checked first, and nothing is saved until you confirm.
            </DialogDescription>

            <div>
              <label htmlFor="import-file" className="text-sm font-medium">
                Excel file
              </label>
              <Input
                id="import-file"
                type="file"
                accept=".xlsx"
                className="mt-1"
                onChange={handleFile}
              />
            </div>

            {step.message && (
              <p role="alert" className="text-sm text-destructive">
                {step.message}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}

        {step.kind === "busy" && (
          <p role="status" className="text-muted-foreground">
            {step.label}
          </p>
        )}

        {step.kind === "errors" && (
          <>
            <DialogDescription>
              This file can't be imported, and nothing was saved. Fix these problems and upload it again.
            </DialogDescription>

            <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {step.errors.map((error, index) => (
                <li key={index}>{error.message}</li>
              ))}
              {step.errors.length === 0 && <li>The file has no purchase orders to import.</li>}
            </ul>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="button" onClick={startAgain}>
                Choose another file
              </Button>
            </div>
          </>
        )}

        {step.kind === "preview" && (
          <>
            <DialogDescription>
              The file is valid: {step.validation.summary && totals(step.validation.summary)} Nothing has been saved yet.
            </DialogDescription>

            <PreviewTable validation={step.validation} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={startAgain}>
                Choose another file
              </Button>
              <Button
                type="button"
                onClick={() => setStep({ ...step, kind: "confirm" })}
              >
                Continue to import
              </Button>
            </div>
          </>
        )}

        {step.kind === "confirm" && (
          <>
            <DialogDescription>
              Create {plural(step.validation.orders.length, "purchase order")} from this file?
            </DialogDescription>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep({ ...step, kind: "preview" })}
              >
                Back
              </Button>
              <Button type="button" onClick={() => handleImport(step.rows)}>
                Confirm import
              </Button>
            </div>
          </>
        )}

        {step.kind === "done" && (
          <>
            <p role="status" className="text-sm">
              Imported: {totals(step.result.summary)}
            </p>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total Quantity</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {step.result.imported.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.poNumber}</TableCell>
                      <TableCell>{order.items}</TableCell>
                      <TableCell>{order.totalQuantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewTable({ validation }: { validation: ValidationResult }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PO Number</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Order Date</TableHead>
            <TableHead>Expected Delivery</TableHead>
            <TableHead>Items</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {validation.orders.map((order) => (
            <TableRow key={order.poNumber}>
              <TableCell className="font-medium">{order.poNumber}</TableCell>
              <TableCell>{order.supplierName}</TableCell>
              <TableCell>{formatDate(order.orderDate)}</TableCell>
              <TableCell>{formatDate(order.expectedDeliveryDate)}</TableCell>
              <TableCell>
                {order.items.map((item) => (
                  <div key={item.articleNumber}>
                    {item.articleNumber} × {item.quantityOrdered}
                  </div>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default PurchaseOrderImportDialog;
