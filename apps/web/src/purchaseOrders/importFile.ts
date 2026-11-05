// Reads a purchase order Excel file into the rows the API expects, and builds
// the template. Only the file's structure is decided here: anything wrong with
// a value is sent as it is, so the API reports it against its row. No row with
// data is ever left out.
import * as XLSX from "xlsx";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 500;
export const TEMPLATE_FILE_NAME = "purchase-order-template.xlsx";

// Rows read from a sheet. A larger sheet is refused rather than cut off, and a
// small file can't make the browser unpack millions of cells.
const MAX_SHEET_ROWS = 2_000;

export type ImportRow = {
  rowNumber: number;
  poNumber: string;
  supplierCode: string;
  articleNumber: string;
  quantityOrdered: unknown;
  orderDate: unknown;
  expectedDeliveryDate: unknown;
};

export type ImportError = {
  rowNumber: number;
  field: string;
  message: string;
};

// The file as a whole can't be used, with a message to show to the user as is.
export class ImportFileError extends Error {}

const COLUMNS = [
  { header: "PO Number", field: "poNumber" },
  { header: "Supplier Code", field: "supplierCode" },
  { header: "Item Number", field: "articleNumber" },
  { header: "Ordered", field: "quantityOrdered" },
  { header: "Order Date", field: "orderDate" },
  { header: "Expected Delivery", field: "expectedDeliveryDate" },
] as const;

export function buildImportTemplate() {
  const worksheet = XLSX.utils.aoa_to_sheet([COLUMNS.map((column) => column.header)]);
  worksheet["!cols"] = COLUMNS.map(() => ({ wch: 18 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Purchase Orders");

  return workbook;
}

export function downloadImportTemplate() {
  XLSX.writeFile(buildImportTemplate(), TEMPLATE_FILE_NAME);
}

// A message explaining why this file can't be read, or null.
export function fileProblem(name: string, size: number) {
  if (!name.toLowerCase().endsWith(".xlsx")) {
    return "Please choose an .xlsx file.";
  }

  if (size > MAX_FILE_BYTES) {
    return "The file must be 5 MB or smaller.";
  }

  return null;
}

// A date read straight from a cell holds the date shown in Excel in its UTC
// fields, whatever the computer's timezone. Its local fields can be a day off.
function calendarDate(date: Date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// A cell's value as it can be sent in JSON; null when the cell is blank.
function plainValue(cell: XLSX.CellObject | undefined) {
  const value = cell?.v;

  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return calendarDate(value);
  }

  if (typeof value === "string") {
    return value.trim() === "" ? null : value.trim();
  }

  return value;
}

// An error such as #DIV/0!, or a formula with no saved result. Either would
// otherwise look like a blank cell, which is allowed for Expected Delivery.
function hasNoUsableValue(cell: XLSX.CellObject | undefined) {
  return cell?.t === "e" || (cell?.f !== undefined && cell.v === undefined);
}

// The bytes every .xlsx file starts with, as a zip archive ("PK", 3, 4).
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function readWorkbook(data: ArrayBuffer) {
  const start = new Uint8Array(data, 0, Math.min(ZIP_SIGNATURE.length, data.byteLength));

  // The library would also read other formats, such as a CSV or web page that
  // was renamed.
  if (!ZIP_SIGNATURE.every((byte, index) => start[index] === byte)) {
    throw new ImportFileError("This is not a valid .xlsx file.");
  }

  try {
    return XLSX.read(data, { type: "array", cellDates: true, sheetRows: MAX_SHEET_ROWS });
  } catch {
    throw new ImportFileError("The file could not be read. It may be damaged or password protected.");
  }
}

function hasCells(worksheet: XLSX.WorkSheet) {
  return Object.keys(worksheet).some((key) => !key.startsWith("!"));
}

// The one worksheet with data. Reading only the first of several could leave
// rows out without anyone noticing.
function dataSheet(workbook: XLSX.WorkBook) {
  const worksheets = workbook.SheetNames.map((name) => workbook.Sheets[name]).filter(hasCells);

  if (worksheets.length === 0) {
    throw new ImportFileError("The file has no data rows.");
  }

  if (worksheets.length > 1) {
    throw new ImportFileError("The file must have data on one worksheet only.");
  }

  return worksheets[0];
}

// Finds each column in the first used row, and refuses anything but the
// template's columns.
function readColumns(worksheet: XLSX.WorkSheet, range: XLSX.Range) {
  const found = new Map<string, number[]>();
  const unexpected: string[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const value = plainValue(worksheet[XLSX.utils.encode_cell({ r: range.s.r, c })]);

    if (value === null) {
      continue;
    }

    const heading = String(value);
    const column = COLUMNS.find((candidate) => candidate.header.toLowerCase() === heading.toLowerCase());

    if (column) {
      found.set(column.header, [...(found.get(column.header) ?? []), c]);
    } else {
      unexpected.push(heading);
    }
  }

  const missing = COLUMNS.filter((column) => !found.has(column.header)).map((column) => column.header);
  const repeated = [...found].filter(([, positions]) => positions.length > 1).map(([header]) => header);
  const problems = [
    missing.length > 0 && `Missing columns: ${missing.join(", ")}.`,
    repeated.length > 0 && `Repeated columns: ${repeated.join(", ")}.`,
    unexpected.length > 0 && `Unexpected columns: ${unexpected.join(", ")}.`,
  ].filter(Boolean);

  if (problems.length > 0) {
    throw new ImportFileError(`${problems.join(" ")} Please use the template's columns.`);
  }

  return new Map(COLUMNS.map((column) => [found.get(column.header)![0], column]));
}

// Returns the file's rows, and any cells that have no usable value. Fully blank
// rows are skipped; every other row is either returned or reported.
export function readImportFile(data: ArrayBuffer): { rows: ImportRow[]; errors: ImportError[] } {
  const worksheet = dataSheet(readWorkbook(data));
  const ref = worksheet["!ref"];

  if (!ref) {
    throw new ImportFileError("The file has no data rows.");
  }

  const range = XLSX.utils.decode_range(ref);
  const fullRef = worksheet["!fullref"];

  if (fullRef && XLSX.utils.decode_range(fullRef).e.r > range.e.r) {
    throw new ImportFileError(`The file can have at most ${MAX_DATA_ROWS} data rows.`);
  }

  const columns = readColumns(worksheet, range);
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  let dataRows = 0;

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const rowNumber = r + 1;
    const values: Record<string, unknown> = {};
    let blank = true;
    let usable = true;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell: XLSX.CellObject | undefined = worksheet[XLSX.utils.encode_cell({ r, c })];
      const column = columns.get(c);
      const value = plainValue(cell);

      if (hasNoUsableValue(cell)) {
        blank = false;
        usable = false;
        errors.push({
          rowNumber,
          field: column?.field ?? "",
          message: `Row ${rowNumber}: ${column?.header ?? "A cell"} has an Excel error or a formula with no result`,
        });
      } else if (value !== null) {
        blank = false;

        if (column) {
          values[column.field] = value;
        } else {
          usable = false;
          errors.push({
            rowNumber,
            field: "",
            message: `Row ${rowNumber}: there is a value in a column with no heading`,
          });
        }
      }
    }

    if (blank) {
      continue;
    }

    dataRows++;

    if (usable) {
      rows.push({
        rowNumber,
        poNumber: String(values.poNumber ?? ""),
        supplierCode: String(values.supplierCode ?? ""),
        articleNumber: String(values.articleNumber ?? ""),
        quantityOrdered: values.quantityOrdered ?? null,
        orderDate: values.orderDate ?? null,
        expectedDeliveryDate: values.expectedDeliveryDate ?? null,
      });
    }
  }

  if (dataRows === 0) {
    throw new ImportFileError("The file has no data rows.");
  }

  if (dataRows > MAX_DATA_ROWS) {
    throw new ImportFileError(`The file can have at most ${MAX_DATA_ROWS} data rows; this one has ${dataRows}.`);
  }

  return { rows, errors };
}
