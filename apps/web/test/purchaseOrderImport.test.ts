// Reading purchase order Excel files, the template, and the import API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";
import {
  canImport,
  createPurchaseOrderImportApi,
  ImportRequestFailure,
  type ValidationResult,
} from "../src/purchaseOrders/importApi.ts";
import {
  buildImportTemplate,
  fileProblem,
  ImportFileError,
  MAX_FILE_BYTES,
  readImportFile,
  TEMPLATE_FILE_NAME,
} from "../src/purchaseOrders/importFile.ts";

const HEADERS = ["PO Number", "Supplier Code", "Item Number", "Ordered", "Order Date", "Expected Delivery"];

// A date cell as Excel stores it. 46330 is 2026-11-04.
const excelDate = (serial: number): XLSX.CellObject => ({ t: "n", v: serial, z: "yyyy-mm-dd" });

const row = (overrides: unknown[] = []) => {
  const values: unknown[] = ["PO-1", "SUP-1", "ITEM-1", 10, excelDate(46330), excelDate(46346)];
  overrides.forEach((value, index) => {
    if (value !== undefined) values[index] = value;
  });
  return values;
};

function workbookWith(...sheets: unknown[][][]) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((rows, index) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), `Sheet${index + 1}`);
  });
  return workbook;
}

function fileFrom(workbook: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

const fileWith = (...rows: unknown[][]) => fileFrom(workbookWith([HEADERS, ...rows]));

function refused(data: ArrayBuffer, message: RegExp) {
  assert.throws(
    () => readImportFile(data),
    (error: unknown) => error instanceof ImportFileError && message.test(error.message),
  );
}

test("only .xlsx files up to 5 MB are accepted", () => {
  assert.equal(fileProblem("orders.xlsx", MAX_FILE_BYTES), null);
  assert.equal(fileProblem("ORDERS.XLSX", 1), null);
  assert.match(fileProblem("orders.xlsx", MAX_FILE_BYTES + 1) ?? "", /5 MB/);

  for (const name of ["orders.xls", "orders.csv", "orders.xlsx.exe", "orders"]) {
    assert.match(fileProblem(name, 1) ?? "", /\.xlsx/, name);
  }
});

test("the template has the expected name and columns, and no data", () => {
  const workbook = buildImportTemplate();
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];

  assert.equal(TEMPLATE_FILE_NAME, "purchase-order-template.xlsx");
  assert.deepEqual(XLSX.utils.sheet_to_json(worksheet, { header: 1 }), [HEADERS]);
  refused(fileFrom(workbook), /no data rows/);
});

test("rows keep their real Excel row numbers, and fully blank rows are skipped", () => {
  const { rows, errors } = readImportFile(fileWith(row(), [], [" "], row(["PO-2"])));

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    {
      rowNumber: 2,
      poNumber: "PO-1",
      supplierCode: "SUP-1",
      articleNumber: "ITEM-1",
      quantityOrdered: 10,
      orderDate: "2026-11-04",
      expectedDeliveryDate: "2026-11-20",
    },
    {
      rowNumber: 5,
      poNumber: "PO-2",
      supplierCode: "SUP-1",
      articleNumber: "ITEM-1",
      quantityOrdered: 10,
      orderDate: "2026-11-04",
      expectedDeliveryDate: "2026-11-20",
    },
  ]);
});

// Reads the file in a new process, as a computer in that timezone would.
const READ_IN_CHILD = `
import { readFileSync } from "node:fs";
const { readImportFile } = await import(process.env.IMPORT_FILE_MODULE);
const { buffer, byteOffset, byteLength } = readFileSync(0);
const { rows } = readImportFile(buffer.slice(byteOffset, byteOffset + byteLength));
console.log(JSON.stringify(rows.map((only) => [only.orderDate, only.expectedDeliveryDate])));
`;

test("dates don't shift in any timezone, including with a time of day", () => {
  // 500 days in a row, so every daylight saving change in a year is crossed.
  const FIRST_DAY = 46023; // 2026-01-01
  const days = Array.from({ length: 500 }, (_, index) => FIRST_DAY + index);
  const data = fileWith(
    ...days.map((day) => row([undefined, undefined, undefined, undefined, excelDate(day), excelDate(day + 0.99)])),
  );
  const expected = days.map((day) => {
    const date = new Date(Date.UTC(2026, 0, 1 + day - FIRST_DAY)).toISOString().slice(0, 10);
    return [date, date];
  });

  for (const zone of [
    "UTC",
    "America/Los_Angeles",
    "America/Havana",
    "America/St_Johns",
    "Europe/London",
    "Asia/Kolkata",
    "Asia/Kathmandu",
    "Australia/Lord_Howe",
    "Pacific/Auckland",
    "Pacific/Kiritimati",
    "Pacific/Pago_Pago",
  ]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TZ: zone,
      IMPORT_FILE_MODULE: import.meta.resolve("../src/purchaseOrders/importFile.ts"),
    };
    delete env.NODE_TEST_CONTEXT;

    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", READ_IN_CHILD], {
      encoding: "utf8",
      env,
      input: Buffer.from(data),
      timeout: 30_000,
    });

    assert.equal(child.error, undefined, zone);
    assert.equal(child.status, 0, `${zone}: ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout), expected, zone);
  }
});

test("a workbook using the 1904 date system reads the same dates", () => {
  const workbook = workbookWith([HEADERS, row([undefined, undefined, undefined, undefined, excelDate(46330 - 1462), ""])]);
  workbook.Workbook = { WBProps: { date1904: true } };

  assert.equal(readImportFile(fileFrom(workbook)).rows[0].orderDate, "2026-11-04");
});

test("values that look wrong are sent as they are for the API to report, not dropped or guessed", () => {
  const { rows, errors } = readImportFile(
    fileWith(
      row(["", "", "", "", "", ""]).map((value, index) => (index === 0 ? "PO-1" : value)),
      row([undefined, undefined, undefined, "ten", "04/11/2026", 46346]),
      row([1001, 200, 300, -5, "2026-11-04", "  "]),
    ),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(rows[0], {
    rowNumber: 2,
    poNumber: "PO-1",
    supplierCode: "",
    articleNumber: "",
    quantityOrdered: null,
    orderDate: null,
    expectedDeliveryDate: null,
  });
  assert.equal(rows[1].quantityOrdered, "ten");
  assert.equal(rows[1].orderDate, "04/11/2026");
  assert.equal(rows[1].expectedDeliveryDate, 46346);
  assert.deepEqual(
    [rows[2].poNumber, rows[2].supplierCode, rows[2].articleNumber, rows[2].quantityOrdered, rows[2].orderDate, rows[2].expectedDeliveryDate],
    ["1001", "200", "300", -5, "2026-11-04", null],
  );
});

test("an Excel error or a formula with no result is reported, not read as blank", () => {
  const { rows, errors } = readImportFile(
    fileWith(
      row([undefined, undefined, undefined, undefined, undefined, { t: "e", v: 7 }]),
      row(["PO-2"]),
      row([undefined, undefined, undefined, undefined, undefined, { t: "n", f: "NOW()" }]),
    ),
  );

  assert.deepEqual(rows.map((only) => only.rowNumber), [3]);
  assert.deepEqual(errors.map((error) => [error.rowNumber, error.field]), [
    [2, "expectedDeliveryDate"],
    [4, "expectedDeliveryDate"],
  ]);
  assert.match(errors[0].message, /^Row 2: Expected Delivery has an Excel error/);
});

test("a value in a column with no heading is reported, not ignored", () => {
  const { rows, errors } = readImportFile(fileWith([...row(), "extra"]));

  assert.deepEqual(rows, []);
  assert.match(errors[0].message, /^Row 2: there is a value in a column with no heading/);
});

test("headings can differ in case and spacing, but must be the template's columns", () => {
  const rows = [[...HEADERS.map((header) => ` ${header.toUpperCase()} `)], row()];
  assert.equal(readImportFile(fileFrom(workbookWith(rows))).rows.length, 1);

  refused(fileFrom(workbookWith([HEADERS.slice(0, 5), row().slice(0, 5)])), /Missing columns: Expected Delivery/);
  refused(fileFrom(workbookWith([[...HEADERS, "Notes"], row()])), /Unexpected columns: Notes/);
  refused(fileFrom(workbookWith([[...HEADERS, "Ordered"], row()])), /Repeated columns: Ordered/);
  refused(fileFrom(workbookWith([["Purchase Orders 2026"], HEADERS, row()])), /Missing columns/);
});

test("500 data rows are accepted and 501 are refused, not cut off", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => row([`PO-${index}`]));

  assert.equal(readImportFile(fileWith(...many(500))).rows.length, 500);
  refused(fileWith(...many(501)), /at most 500 data rows; this one has 501/);
  refused(fileWith(...many(2_500)), /at most 500 data rows/);
});

test("a row far down the sheet is refused rather than silently left out", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, row()]);
  XLSX.utils.sheet_add_aoa(worksheet, [row(["PO-FAR"])], { origin: "A3000" });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  refused(fileFrom(workbook), /at most 500 data rows/);
});

test("data on a second worksheet is refused; an empty second worksheet is fine", () => {
  refused(fileFrom(workbookWith([HEADERS, row()], [HEADERS, row(["PO-2"])])), /one worksheet only/);
  assert.equal(readImportFile(fileFrom(workbookWith([HEADERS, row()], []))).rows.length, 1);
});

test("files that aren't really .xlsx are refused", () => {
  const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

  refused(encode("PO Number,Supplier Code\nPO-1,SUP-1\n"), /not a valid \.xlsx/);
  refused(new ArrayBuffer(0), /not a valid \.xlsx/);
  // Only part of the four-byte signature.
  refused(encode("PK this is not really a zip file"), /not a valid \.xlsx/);
  refused(encode("PK\x03"), /not a valid \.xlsx/);
  refused(encode("PK\x03\x05 almost the signature"), /not a valid \.xlsx/);
  // The right signature, but not a real workbook.
  refused(encode("PK\x03\x04 not really a zip file"), /could not be read/);
});

// --- API calls ---------------------------------------------------------------

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function recording(response: () => Response | Promise<Response>) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createPurchaseOrderImportApi(async (path, init) => {
    calls.push({ path, init });
    return response();
  });

  return { api, calls };
}

const ROWS = readImportFile(fileWith(row())).rows;

const validation = (overrides: Partial<ValidationResult>): ValidationResult => ({
  valid: true,
  summary: { purchaseOrders: 1, items: 1, rows: 1, totalQuantity: 10 },
  orders: [
    {
      poNumber: "PO-1",
      supplierCode: "SUP-1",
      supplierName: "Supplier",
      orderDate: "2026-11-04",
      expectedDeliveryDate: null,
      items: [{ articleNumber: "ITEM-1", productName: "Item", quantityOrdered: 10, rowNumbers: [2] }],
    },
  ],
  errors: [],
  ...overrides,
});

test("validate and import post the rows to their own routes as JSON", async () => {
  const { api, calls } = recording(() => json(200, validation({})));

  await api.validate(ROWS);
  await api.importRows(ROWS);

  assert.deepEqual(calls.map((call) => call.path), ["/purchase-orders/import/validate", "/purchase-orders/import"]);

  for (const call of calls) {
    assert.equal(call.init?.method, "POST");
    assert.deepEqual(call.init?.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(call.init?.body)), { rows: ROWS });
  }
});

test("only a valid result with orders and no errors can lead to an import", () => {
  const error = { rowNumber: 2, field: "poNumber", message: "Row 2: bad" };

  assert.equal(canImport(validation({})), true);
  assert.equal(canImport(validation({ valid: false, summary: null, orders: [], errors: [error] })), false);
  assert.equal(canImport(validation({ valid: false })), false);
  assert.equal(canImport(validation({ errors: [error] })), false);
  assert.equal(canImport(validation({ orders: [] })), false);
});

test("a rejected import passes on the API's message and row errors", async () => {
  const errors = [{ rowNumber: 2, field: "poNumber", message: 'Row 2: PO number "PO-1" already exists' }];
  const { api } = recording(() => json(422, { error: "The file has errors; nothing was saved", errors }));

  await assert.rejects(api.importRows(ROWS), (error: unknown) => {
    assert.ok(error instanceof ImportRequestFailure);
    assert.equal(error.message, "The file has errors; nothing was saved");
    assert.deepEqual(error.errors, errors);
    return true;
  });
});

test("a conflict shows the API's message; an unreadable error gets a fixed one", async () => {
  await assert.rejects(
    recording(() => json(409, { error: "The data changed" })).api.importRows(ROWS),
    (error: unknown) => error instanceof ImportRequestFailure && error.message === "The data changed" && error.errors.length === 0,
  );
  await assert.rejects(
    recording(() => new Response("<html>", { status: 500 })).api.importRows(ROWS),
    /could not be imported/,
  );
});

test("with no clear answer, an import warns that it may have been saved", async () => {
  const noResponse = recording(() => Promise.reject(new TypeError("Failed to fetch")));
  const unreadable = recording(() => new Response("not json", { status: 201 }));

  await assert.rejects(noResponse.api.importRows(ROWS), /may or may not have been saved/);
  await assert.rejects(unreadable.api.importRows(ROWS), /may or may not have been saved/);
  await assert.rejects(noResponse.api.validate(ROWS), /could not be reached/);
});
