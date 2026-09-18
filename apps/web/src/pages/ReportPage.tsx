import { useState } from "react";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ReportRow = {
  receivingId: number;
  receivedAt: string;
  purchaseOrderId: number;
  poNumber: string;
  supplier: string;
  purchaseOrderItemId: number;
  articleNumber: string;
  product: string;
  quantityOrdered: number;
  previouslyReceived: number;
  quantityReceived: number;
  remainingQuantity: number;
  difference: number;
  reasonCode: string | null;
  actionStatus: string | null;
  epCount: number;
};

type ReportResponse = {
  date: string;
  summary: {
    totalPurchaseOrders: number;
    totalItems: number;
    totalDelivered: number;
    totalEpKasser: number;
    totalDiscrepancies: number;
  };
  rows: ReportRow[];
};

function ReportPage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [showFullReport, setShowFullReport] = useState(false);

  async function generateReport() {
    try {
      setLoading(true);
      setError("");
      setShowFullReport(false);

      const response = await fetch(
        `http://localhost:3000/receivings/report?date=${date}`,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        throw new Error(errorData?.error || "Failed to generate report");
      }

      const data: ReportResponse = await response.json();

      setReport(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate report",
      );
    } finally {
      setLoading(false);
    }
  }

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString();
  }

  function exportSummaryExcel() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const data = [
        ["ReceiveFlow - End-of-Day Summary"],
        [`Report Date: ${report.date}`],
        [],
        ["Summary", "Value"],
        ["Total POs", report.summary.totalPurchaseOrders],
        ["Total Items", report.summary.totalItems],
        ["Total Delivered", report.summary.totalDelivered],
        ["Total EP Kasser", report.summary.totalEpKasser],
        ["Total Discrepancies", report.summary.totalDiscrepancies],
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(data);

      worksheet["!cols"] = [{ wch: 25 }, { wch: 18 }];

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, "Summary");

      XLSX.writeFile(workbook, `ReceiveFlow_Summary_${report.date}.xlsx`);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to export summary Excel file.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportDiscrepanciesExcel() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const discrepancyRows = report.rows.filter((row) => row.difference !== 0);

      const data = [
        ["ReceiveFlow - Discrepancy Summary"],
        [`Report Date: ${report.date}`],
        [],
        [
          "PO Number",
          "Supplier",
          "Article",
          "Product",
          "Ordered",
          "Delivered",
          "Difference",
          "Reason Code",
          "Action Required",
        ],
        ...discrepancyRows.map((row) => [
          row.poNumber,
          row.supplier,
          row.articleNumber,
          row.product,
          row.quantityOrdered,
          row.quantityReceived,
          row.difference,
          row.reasonCode ?? "",
          row.actionStatus ?? "",
        ]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(data);

      worksheet["!cols"] = [
        { wch: 15 },
        { wch: 25 },
        { wch: 15 },
        { wch: 30 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 25 },
        { wch: 25 },
      ];

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, "Discrepancies");

      XLSX.writeFile(workbook, `ReceiveFlow_Discrepancies_${report.date}.xlsx`);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to export discrepancies Excel file.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportFullReportExcel() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const data = [
        ["ReceiveFlow - Full Receiving Report"],
        [`Report Date: ${report.date}`],
        [],
        [
          "PO Number",
          "Supplier",
          "Article",
          "Product",
          "Ordered",
          "Previously Received",
          "Delivered",
          "Remaining",
          "Difference",
          "Reason Code",
          "Action Required",
          "EP Kasser",
          "Received At",
        ],
        ...report.rows.map((row) => [
          row.poNumber,
          row.supplier,
          row.articleNumber,
          row.product,
          row.quantityOrdered,
          row.previouslyReceived,
          row.quantityReceived,
          row.remainingQuantity,
          row.difference,
          row.reasonCode ?? "",
          row.actionStatus ?? "",
          row.epCount,
          formatDateTime(row.receivedAt),
        ]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(data);

      worksheet["!cols"] = [
        { wch: 15 },
        { wch: 25 },
        { wch: 15 },
        { wch: 30 },
        { wch: 12 },
        { wch: 18 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 25 },
        { wch: 25 },
        { wch: 12 },
        { wch: 22 },
      ];

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Full Receiving Report",
      );

      XLSX.writeFile(workbook, `ReceiveFlow_Full_Report_${report.date}.xlsx`);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to export full report Excel file.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportSummaryPdf() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const pdf = new jsPDF();

      pdf.setFontSize(18);
      pdf.text("ReceiveFlow - End-of-Day Summary", 14, 20);

      pdf.setFontSize(11);
      pdf.text(`Report Date: ${report.date}`, 14, 28);

      autoTable(pdf, {
        startY: 38,
        head: [["Summary", "Value"]],
        body: [
          ["Total POs", report.summary.totalPurchaseOrders],
          ["Total Items", report.summary.totalItems],
          ["Total Delivered", report.summary.totalDelivered],
          ["Total EP Kasser", report.summary.totalEpKasser],
          ["Total Discrepancies", report.summary.totalDiscrepancies],
        ],
      });

      pdf.save(`ReceiveFlow_Summary_${report.date}.pdf`);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to export summary PDF.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportDiscrepanciesPdf() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const discrepancyRows = report.rows.filter((row) => row.difference !== 0);

      const pdf = new jsPDF({
        orientation: "landscape",
      });

      pdf.setFontSize(18);
      pdf.text("ReceiveFlow - Discrepancy Summary", 14, 20);

      pdf.setFontSize(11);
      pdf.text(`Report Date: ${report.date}`, 14, 28);

      autoTable(pdf, {
        startY: 36,
        head: [
          [
            "PO Number",
            "Supplier",
            "Article",
            "Product",
            "Ordered",
            "Delivered",
            "Difference",
            "Reason",
            "Action",
          ],
        ],
        body: discrepancyRows.map((row) => [
          row.poNumber,
          row.supplier,
          row.articleNumber,
          row.product,
          row.quantityOrdered,
          row.quantityReceived,
          row.difference,
          row.reasonCode ?? "—",
          row.actionStatus ?? "—",
        ]),
        styles: {
          fontSize: 8,
        },
      });

      pdf.save(`ReceiveFlow_Discrepancies_${report.date}.pdf`);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to export discrepancies PDF.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportFullReportPdf() {
    if (!report) {
      return;
    }

    try {
      setExporting(true);

      const pdf = new jsPDF({
        orientation: "landscape",
      });

      pdf.setFontSize(18);
      pdf.text("ReceiveFlow - Full Receiving Report", 14, 20);

      pdf.setFontSize(11);
      pdf.text(`Report Date: ${report.date}`, 14, 28);

      autoTable(pdf, {
        startY: 36,
        head: [
          [
            "PO",
            "Supplier",
            "Article",
            "Product",
            "Ordered",
            "Prev. Received",
            "Delivered",
            "Remaining",
            "Difference",
            "Reason",
            "Action",
            "EP",
            "Received At",
          ],
        ],
        body: report.rows.map((row) => [
          row.poNumber,
          row.supplier,
          row.articleNumber,
          row.product,
          row.quantityOrdered,
          row.previouslyReceived,
          row.quantityReceived,
          row.remainingQuantity,
          row.difference,
          row.reasonCode ?? "—",
          row.actionStatus ?? "—",
          row.epCount,
          formatDateTime(row.receivedAt),
        ]),
        styles: {
          fontSize: 7,
        },
      });

      pdf.save(`ReceiveFlow_Full_Report_${report.date}.pdf`);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to export full report PDF.",
      );
    } finally {
      setExporting(false);
    }
  }

  const discrepancyRows =
    report?.rows.filter((row) => row.difference !== 0) ?? [];

  return (
    <div>
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">End-of-Day Report</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Review receiving activity and discrepancies for a selected day.
        </p>
      </div>

      {/* Date Selection */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="report-date"
            className="mb-2 block text-sm font-medium"
          >
            Report Date
          </label>

          <input
            id="report-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <Button
          type="button"
          onClick={generateReport}
          disabled={loading || !date}
        >
          {loading ? "Generating..." : "Generate Report"}
        </Button>
      </div>

      {/* Error */}
      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

      {/* Report */}
      {report && !error && (
        <div className="mt-8">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total POs</p>

              <p className="mt-1 text-2xl font-bold">
                {report.summary.totalPurchaseOrders}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total Items</p>

              <p className="mt-1 text-2xl font-bold">
                {report.summary.totalItems}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total Delivered</p>

              <p className="mt-1 text-2xl font-bold">
                {report.summary.totalDelivered}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total EP Kasser</p>

              <p className="mt-1 text-2xl font-bold">
                {report.summary.totalEpKasser}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Total Discrepancies
              </p>

              <p className="mt-1 text-2xl font-bold">
                {report.summary.totalDiscrepancies}
              </p>
            </div>
          </div>

          {/* Discrepancy Summary View */}
          {!showFullReport && (
            <div className="mt-8">
              <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Discrepancy Summary</h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Receiving items with a difference from the expected
                    remaining quantity.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFullReport(true)}
                >
                  Show Full Receiving Report
                </Button>
              </div>

              {discrepancyRows.length === 0 ? (
                <div className="rounded-lg border p-8 text-center">
                  <p className="font-medium">No discrepancies found.</p>

                  <p className="mt-2 text-sm text-muted-foreground">
                    All receiving records for this date match the expected
                    quantities.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                          PO Number
                        </th>

                        <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                          Supplier
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
                      {discrepancyRows.map((row) => (
                        <tr
                          key={`${row.receivingId}-${row.purchaseOrderItemId}`}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-medium">
                            {row.poNumber}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.supplier}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.articleNumber}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.product}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.quantityOrdered}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.quantityReceived}
                          </td>

                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              row.difference < 0
                                ? "text-destructive"
                                : row.difference > 0
                                  ? "text-green-600"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {row.difference > 0
                              ? `+${row.difference}`
                              : row.difference}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.reasonCode ?? "—"}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.actionStatus ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Full Receiving Report View */}
          {showFullReport && (
            <div className="mt-8">
              <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    Full Receiving Report
                  </h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    All receiving records for {report.date}.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFullReport(false)}
                >
                  Show Discrepancy Summary
                </Button>
              </div>

              {report.rows.length === 0 ? (
                <div className="rounded-lg border p-8 text-center">
                  <p className="font-medium">No receiving records found.</p>

                  <p className="mt-2 text-sm text-muted-foreground">
                    There were no receiving records for {report.date}.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                          PO Number
                        </th>

                        <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                          Supplier
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
                          Previously Received
                        </th>

                        <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                          Delivered
                        </th>

                        <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                          Remaining
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

                        <th className="whitespace-nowrap px-3 py-3 text-right font-medium">
                          EP Kasser
                        </th>

                        <th className="whitespace-nowrap px-3 py-3 text-left font-medium">
                          Received At
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {report.rows.map((row) => (
                        <tr
                          key={`${row.receivingId}-${row.purchaseOrderItemId}`}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-medium">
                            {row.poNumber}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.supplier}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.articleNumber}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.product}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.quantityOrdered}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.previouslyReceived}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.quantityReceived}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.remainingQuantity}
                          </td>

                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              row.difference < 0
                                ? "text-destructive"
                                : row.difference > 0
                                  ? "text-green-600"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {row.difference > 0
                              ? `+${row.difference}`
                              : row.difference}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.reasonCode ?? "—"}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {row.actionStatus ?? "—"}
                          </td>

                          <td className="px-3 py-2 text-right">
                            {row.epCount}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2">
                            {formatDateTime(row.receivedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Export Reports */}
          <div className="mt-8 rounded-lg border p-6">
            <h2 className="text-xl font-semibold">Export Reports</h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Choose the report and file format you want to export.
            </p>

            <div className="mt-6 space-y-6">
              {/* Summary */}
              <div>
                <h3 className="font-medium">Summary</h3>

                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportSummaryExcel}
                    disabled={exporting}
                  >
                    Export Excel
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportSummaryPdf}
                    disabled={exporting}
                  >
                    Export PDF
                  </Button>
                </div>
              </div>

              {/* Discrepancies */}
              <div>
                <h3 className="font-medium">Discrepancies</h3>

                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportDiscrepanciesExcel}
                    disabled={exporting}
                  >
                    Export Excel
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportDiscrepanciesPdf}
                    disabled={exporting}
                  >
                    Export PDF
                  </Button>
                </div>
              </div>

              {/* Full Report */}
              <div>
                <h3 className="font-medium">Full Receiving Report</h3>

                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportFullReportExcel}
                    disabled={exporting}
                  >
                    Export Excel
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportFullReportPdf}
                    disabled={exporting}
                  >
                    Export PDF
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReportPage;
