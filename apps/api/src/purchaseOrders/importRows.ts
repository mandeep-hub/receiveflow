// Excel purchase order import: the checks that need no database. Everything
// arrives from the browser, so nothing here assumes the frontend checked it.
export const MAX_IMPORT_ROWS = 500;
// The last row of an Excel worksheet.
export const MAX_EXCEL_ROW = 1_048_576;

const MAX_FIELD_LENGTH = 100;
// quantityOrdered is a PostgreSQL integer.
const MAX_QUANTITY = 2_147_483_647;
// PostgreSQL text can't store a NUL character, and no code or number needs these.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ImportRow = {
  rowNumber: number;
  poNumber: string;
  supplierCode: string;
  articleNumber: string;
  quantityOrdered: number;
  orderDate: string;
  expectedDeliveryDate: string | null;
};

export type ImportError = {
  rowNumber: number;
  field: string;
  message: string;
};

export type GroupedItem = {
  articleNumber: string;
  quantityOrdered: number;
  rowNumbers: number[];
};

export type GroupedOrder = {
  poNumber: string;
  supplierCode: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  // The first Excel row of this PO, where PO-level errors are reported.
  rowNumber: number;
  items: GroupedItem[];
};

// The request as a whole can't be read, so there are no rows to report on.
export class ImportRequestError extends Error {}

export function isCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Checks every row and returns the valid ones with all errors found, so one
// upload can report everything that needs fixing.
export function readImportRows(body: unknown): { rows: ImportRow[]; errors: ImportError[] } {
  const rawRows = (body as { rows?: unknown } | null | undefined)?.rows;

  if (!Array.isArray(rawRows)) {
    throw new ImportRequestError("rows must be a list");
  }

  if (rawRows.length === 0) {
    throw new ImportRequestError("The file has no data rows");
  }

  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new ImportRequestError(`The file can have at most ${MAX_IMPORT_ROWS} data rows`);
  }

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seenRowNumbers = new Set<number>();

  for (const rawRow of rawRows) {
    const raw = (rawRow ?? {}) as Record<string, unknown>;
    const rowNumber = raw.rowNumber;

    if (
      typeof rowNumber !== "number" ||
      !Number.isInteger(rowNumber) ||
      rowNumber < 1 ||
      rowNumber > MAX_EXCEL_ROW
    ) {
      throw new ImportRequestError("Each row needs a valid rowNumber");
    }

    if (seenRowNumbers.has(rowNumber)) {
      throw new ImportRequestError(`Row number ${rowNumber} appears more than once`);
    }

    seenRowNumbers.add(rowNumber);

    const rowErrors: ImportError[] = [];
    const fail = (field: string, problem: string) =>
      rowErrors.push({ rowNumber, field, message: `Row ${rowNumber}: ${problem}` });

    const readText = (field: string, label: string) => {
      const value = raw[field];

      if (typeof value !== "string" || value.trim() === "") {
        fail(field, `${label} is required`);
        return "";
      }

      const text = value.trim();

      if (text.length > MAX_FIELD_LENGTH) {
        fail(field, `${label} can be at most ${MAX_FIELD_LENGTH} characters`);
      } else if (CONTROL_CHARACTERS.test(text)) {
        fail(field, `${label} contains invalid characters`);
      }

      return text;
    };

    const poNumber = readText("poNumber", "PO Number");
    const supplierCode = readText("supplierCode", "Supplier Code");
    const articleNumber = readText("articleNumber", "Item Number");

    const quantityOrdered = raw.quantityOrdered;

    if (
      typeof quantityOrdered !== "number" ||
      !Number.isInteger(quantityOrdered) ||
      quantityOrdered <= 0 ||
      quantityOrdered > MAX_QUANTITY
    ) {
      fail("quantityOrdered", "Ordered must be a positive whole number");
    }

    const orderDate = raw.orderDate;

    if (typeof orderDate !== "string" || !isCalendarDate(orderDate)) {
      fail("orderDate", "Order Date must be a valid date in YYYY-MM-DD format");
    }

    const expected = raw.expectedDeliveryDate;
    const hasExpected = expected !== undefined && expected !== null && expected !== "";

    if (hasExpected && (typeof expected !== "string" || !isCalendarDate(expected))) {
      fail("expectedDeliveryDate", "Expected Delivery must be a valid date in YYYY-MM-DD format");
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      rowNumber,
      poNumber,
      supplierCode,
      articleNumber,
      quantityOrdered: quantityOrdered as number,
      orderDate: orderDate as string,
      expectedDeliveryDate: hasExpected ? (expected as string) : null,
    });
  }

  return { rows, errors };
}

// Groups rows into one order per PO Number and adds up repeated products. Rows
// of one PO must agree on supplier and dates; a row that doesn't is an error
// rather than a guess about which value is right.
export function groupImportRows(rows: ImportRow[]): { orders: GroupedOrder[]; errors: ImportError[] } {
  const orders = new Map<string, GroupedOrder>();
  const errors: ImportError[] = [];

  for (const row of rows) {
    const { rowNumber, poNumber } = row;
    const order = orders.get(poNumber);

    if (!order) {
      orders.set(poNumber, {
        poNumber,
        supplierCode: row.supplierCode,
        orderDate: row.orderDate,
        expectedDeliveryDate: row.expectedDeliveryDate,
        rowNumber,
        items: [
          {
            articleNumber: row.articleNumber,
            quantityOrdered: row.quantityOrdered,
            rowNumbers: [rowNumber],
          },
        ],
      });
      continue;
    }

    const differs = (field: string, label: string, value: string | null, first: string | null) => {
      if (value === first) {
        return false;
      }

      errors.push({
        rowNumber,
        field,
        message: `Row ${rowNumber}: ${label} "${value ?? ""}" differs from "${first ?? ""}" on row ${order.rowNumber} for PO ${poNumber}`,
      });

      return true;
    };

    // Not short-circuited, so a row reports every field that differs.
    const mismatches = [
      differs("supplierCode", "Supplier Code", row.supplierCode, order.supplierCode),
      differs("orderDate", "Order Date", row.orderDate, order.orderDate),
      differs("expectedDeliveryDate", "Expected Delivery", row.expectedDeliveryDate, order.expectedDeliveryDate),
    ];

    if (mismatches.includes(true)) {
      continue;
    }

    const item = order.items.find((candidate) => candidate.articleNumber === row.articleNumber);

    if (!item) {
      order.items.push({
        articleNumber: row.articleNumber,
        quantityOrdered: row.quantityOrdered,
        rowNumbers: [rowNumber],
      });
    } else if (item.quantityOrdered + row.quantityOrdered > MAX_QUANTITY) {
      errors.push({
        rowNumber,
        field: "quantityOrdered",
        message: `Row ${rowNumber}: the combined Ordered quantity for item ${row.articleNumber} on PO ${poNumber} is too large`,
      });
    } else {
      item.quantityOrdered += row.quantityOrdered;
      item.rowNumbers.push(rowNumber);
    }
  }

  return { orders: [...orders.values()], errors };
}
