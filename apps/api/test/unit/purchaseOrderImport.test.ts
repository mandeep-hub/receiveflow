// Excel purchase order import without a database: row checks, grouping, and the
// import logic against a small in-memory stand-in for Prisma.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ImportConflictError,
  importPurchaseOrders,
  ImportRejectedError,
  validatePurchaseOrderImport,
} from "../../src/purchaseOrders/excelImport.ts";
import {
  groupImportRows,
  ImportRequestError,
  isCalendarDate,
  MAX_EXCEL_ROW,
  MAX_IMPORT_ROWS,
  readImportRows,
} from "../../src/purchaseOrders/importRows.ts";

function row(rowNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    rowNumber,
    poNumber: "PO-1",
    supplierCode: "SUP-1",
    articleNumber: "ART-1",
    quantityOrdered: 5,
    orderDate: "2026-09-22",
    expectedDeliveryDate: null,
    ...overrides,
  };
}

function messages(errors: { message: string }[]) {
  return errors.map((error) => error.message);
}

// Valid rows only, for testing grouping on its own.
function validRows(...rows: Record<string, unknown>[]) {
  const result = readImportRows({ rows });
  assert.deepEqual(result.errors, []);
  return result.rows;
}

// In-memory stand-in for the Prisma calls the import makes. `created` records
// each create; `committed` stays empty unless the transaction callback returns.
function fakeDatabase(options: {
  suppliers?: { code: string; active?: boolean }[];
  products?: { articleNumber: string; active?: boolean }[];
  existingPoNumbers?: string[];
  failCreate?: () => never;
} = {}) {
  const suppliers = (options.suppliers ?? [{ code: "SUP-1" }]).map((supplier, index) => ({
    id: index + 1,
    name: `${supplier.code} name`,
    active: true,
    ...supplier,
  }));
  const products = (options.products ?? [{ articleNumber: "ART-1" }, { articleNumber: "ART-2" }]).map((product, index) => ({
    id: index + 11,
    name: `${product.articleNumber} name`,
    active: true,
    ...product,
  }));
  const created: any[] = [];
  const committed: any[] = [];
  let nextId = 101;

  const tx = {
    supplier: {
      findMany: async ({ where }: any) => suppliers.filter((supplier) => where.code.in.includes(supplier.code)),
    },
    product: {
      findMany: async ({ where }: any) => products.filter((product) => where.articleNumber.in.includes(product.articleNumber)),
    },
    purchaseOrder: {
      findMany: async ({ where }: any) =>
        (options.existingPoNumbers ?? [])
          .filter((poNumber) => where.poNumber.in.includes(poNumber))
          .map((poNumber) => ({ poNumber })),
      create: async ({ data }: any) => {
        options.failCreate?.();
        created.push(data);
        return { id: nextId++, poNumber: data.poNumber };
      },
    },
  };

  const db = {
    ...tx,
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed.push(...created);
      return result;
    },
  } as any;

  return { db, created, committed };
}

test("isCalendarDate accepts real dates only", () => {
  for (const value of ["2026-09-22", "2028-02-29", "2026-12-31"]) {
    assert.equal(isCalendarDate(value), true, value);
  }

  for (const value of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "22-09-2026", "2026-9-22", "2026-09-22T00:00:00Z", "", "soon"]) {
    assert.equal(isCalendarDate(value), false, value);
  }
});

test("a malformed request is refused as a whole", () => {
  for (const body of [undefined, null, {}, { rows: "x" }, { rows: {} }]) {
    assert.throws(() => readImportRows(body), ImportRequestError, JSON.stringify(body));
  }

  assert.throws(() => readImportRows({ rows: [] }), /no data rows/);
  assert.throws(() => readImportRows({ rows: [null] }), /valid rowNumber/);
  assert.throws(() => readImportRows({ rows: [row(0)] }), /valid rowNumber/);
  assert.throws(() => readImportRows({ rows: [row(1.5)] }), /valid rowNumber/);
  assert.throws(() => readImportRows({ rows: [row(2), row(2)] }), /appears more than once/);
});

test("row numbers can go up to the last Excel row and no further", () => {
  assert.equal(MAX_EXCEL_ROW, 1_048_576);
  assert.deepEqual(readImportRows({ rows: [row(1_048_576)] }).errors, []);
  assert.throws(() => readImportRows({ rows: [row(1_048_577)] }), /valid rowNumber/);
});

test("old dates stay valid: there is no minimum or maximum date", () => {
  for (const orderDate of ["1000-01-01", "1999-12-31", "9999-12-31"]) {
    assert.deepEqual(readImportRows({ rows: [row(2, { orderDate })] }).errors, [], orderDate);
  }
});

test("500 rows are accepted and 501 refused", () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => row(index + 2));

  assert.equal(MAX_IMPORT_ROWS, 500);
  assert.equal(readImportRows({ rows: rows.slice(0, 500) }).rows.length, 500);
  assert.throws(() => readImportRows({ rows }), /at most 500 data rows/);
});

test("values are trimmed, and an empty Expected Delivery counts as not given", () => {
  const { rows, errors } = readImportRows({
    rows: [row(2, { poNumber: " PO-1 ", supplierCode: " SUP-1 ", articleNumber: " ART-1 ", expectedDeliveryDate: "" })],
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [row(2)]);
});

test("each invalid field is reported with its Excel row number", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ poNumber: "  " }, "Row 7: PO Number is required"],
    [{ poNumber: 200259 }, "Row 7: PO Number is required"],
    [{ poNumber: "x".repeat(101) }, "Row 7: PO Number can be at most 100 characters"],
    [{ poNumber: "PO\u00001" }, "Row 7: PO Number contains invalid characters"],
    [{ supplierCode: undefined }, "Row 7: Supplier Code is required"],
    [{ articleNumber: "" }, "Row 7: Item Number is required"],
    [{ quantityOrdered: 0 }, "Row 7: Ordered must be a positive whole number"],
    [{ quantityOrdered: -1 }, "Row 7: Ordered must be a positive whole number"],
    [{ quantityOrdered: 1.5 }, "Row 7: Ordered must be a positive whole number"],
    [{ quantityOrdered: "5" }, "Row 7: Ordered must be a positive whole number"],
    [{ quantityOrdered: 2_147_483_648 }, "Row 7: Ordered must be a positive whole number"],
    [{ orderDate: "2026-02-30" }, "Row 7: Order Date must be a valid date in YYYY-MM-DD format"],
    [{ orderDate: 46287 }, "Row 7: Order Date must be a valid date in YYYY-MM-DD format"],
    [{ expectedDeliveryDate: "tomorrow" }, "Row 7: Expected Delivery must be a valid date in YYYY-MM-DD format"],
  ];

  for (const [overrides, message] of cases) {
    const { rows, errors } = readImportRows({ rows: [row(7, overrides)] });

    assert.deepEqual(rows, [], message);
    assert.deepEqual(messages(errors), [message]);
  }
});

test("all invalid fields and rows are reported together", () => {
  const { rows, errors } = readImportRows({
    rows: [row(2), row(3, { poNumber: "", quantityOrdered: 0 }), row(4, { orderDate: "bad" })],
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(messages(errors), [
    "Row 3: PO Number is required",
    "Row 3: Ordered must be a positive whole number",
    "Row 4: Order Date must be a valid date in YYYY-MM-DD format",
  ]);
});

test("rows are grouped by PO Number", () => {
  const { orders, errors } = groupImportRows(
    validRows(row(2), row(3, { poNumber: "PO-2" }), row(4, { articleNumber: "ART-2", quantityOrdered: 7 })),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(orders.map((order) => order.poNumber), ["PO-1", "PO-2"]);
  assert.deepEqual(orders[0].items, [
    { articleNumber: "ART-1", quantityOrdered: 5, rowNumbers: [2] },
    { articleNumber: "ART-2", quantityOrdered: 7, rowNumbers: [4] },
  ]);
  assert.equal(orders[0].rowNumber, 2);
  assert.equal(orders[1].rowNumber, 3);
});

test("repeated products within one PO are combined; other POs stay separate", () => {
  const { orders, errors } = groupImportRows(
    validRows(
      row(2, { quantityOrdered: 5 }),
      row(3, { quantityOrdered: 7 }),
      row(4, { quantityOrdered: 1 }),
      row(5, { poNumber: "PO-2", quantityOrdered: 9 }),
    ),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(orders[0].items, [{ articleNumber: "ART-1", quantityOrdered: 13, rowNumbers: [2, 3, 4] }]);
  assert.deepEqual(orders[1].items, [{ articleNumber: "ART-1", quantityOrdered: 9, rowNumbers: [5] }]);
});

test("a combined quantity too large to store is an error", () => {
  const { errors } = groupImportRows(
    validRows(row(2, { quantityOrdered: 2_147_483_647 }), row(3, { quantityOrdered: 1 })),
  );

  assert.deepEqual(messages(errors), ["Row 3: the combined Ordered quantity for item ART-1 on PO PO-1 is too large"]);
});

test("rows of one PO must agree on supplier and dates", () => {
  const { errors } = groupImportRows(
    validRows(
      row(2),
      row(3, { supplierCode: "SUP-2" }),
      row(4, { orderDate: "2026-09-23" }),
      row(5, { expectedDeliveryDate: "2026-09-25" }),
    ),
  );

  assert.deepEqual(messages(errors), [
    'Row 3: Supplier Code "SUP-2" differs from "SUP-1" on row 2 for PO PO-1',
    'Row 4: Order Date "2026-09-23" differs from "2026-09-22" on row 2 for PO PO-1',
    'Row 5: Expected Delivery "2026-09-25" differs from "" on row 2 for PO PO-1',
  ]);
});

test("validate returns the grouped preview and saves nothing", async () => {
  const { db, created } = fakeDatabase();

  const result = await validatePurchaseOrderImport(db, {
    rows: [row(2, { quantityOrdered: 5 }), row(3, { quantityOrdered: 25 }), row(4, { articleNumber: "ART-2", quantityOrdered: 1 })],
  });

  assert.deepEqual(result, {
    valid: true,
    summary: { purchaseOrders: 1, items: 2, rows: 3, totalQuantity: 31 },
    orders: [
      {
        poNumber: "PO-1",
        supplierCode: "SUP-1",
        supplierName: "SUP-1 name",
        orderDate: "2026-09-22",
        expectedDeliveryDate: null,
        items: [
          { articleNumber: "ART-1", productName: "ART-1 name", quantityOrdered: 30, rowNumbers: [2, 3] },
          { articleNumber: "ART-2", productName: "ART-2 name", quantityOrdered: 1, rowNumbers: [4] },
        ],
      },
    ],
    errors: [],
  });
  assert.deepEqual(created, []);
});

test("validate reports unknown and inactive suppliers and products, and existing POs, in row order", async () => {
  const { db, created } = fakeDatabase({
    suppliers: [{ code: "SUP-1" }, { code: "SUP-OLD", active: false }],
    products: [{ articleNumber: "ART-1" }, { articleNumber: "ART-OLD", active: false }],
    existingPoNumbers: ["PO-5"],
  });

  const result = await validatePurchaseOrderImport(db, {
    rows: [
      row(2, { poNumber: "PO-2", supplierCode: "SUP-NONE" }),
      row(3, { poNumber: "PO-3", supplierCode: "SUP-OLD" }),
      row(4, { poNumber: "PO-4", articleNumber: "ART-NONE" }),
      row(5, { poNumber: "PO-6", articleNumber: "ART-OLD" }),
      row(6, { poNumber: "PO-5" }),
      row(7, { poNumber: "PO-7", quantityOrdered: 0 }),
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.summary, null);
  assert.deepEqual(result.orders, []);
  assert.deepEqual(messages(result.errors), [
    'Row 2: supplier "SUP-NONE" was not found',
    'Row 3: supplier "SUP-OLD" is inactive',
    'Row 4: item "ART-NONE" was not found',
    'Row 5: item "ART-OLD" is inactive',
    'Row 6: PO number "PO-5" already exists',
    "Row 7: Ordered must be a positive whole number",
  ]);
  assert.deepEqual(created, []);
});

test("import saves every order as EXCEL with combined quantities and UTC dates", async () => {
  const { db, committed } = fakeDatabase();

  const result = await importPurchaseOrders(db, {
    rows: [
      row(2, { quantityOrdered: 5, expectedDeliveryDate: "2026-09-25" }),
      row(3, { quantityOrdered: 25, expectedDeliveryDate: "2026-09-25" }),
      row(4, { poNumber: "PO-2", articleNumber: "ART-2", quantityOrdered: 1 }),
    ],
  });

  assert.deepEqual(result, {
    imported: [
      { id: 101, poNumber: "PO-1", items: 1, totalQuantity: 30 },
      { id: 102, poNumber: "PO-2", items: 1, totalQuantity: 1 },
    ],
    summary: { purchaseOrders: 2, items: 2, rows: 3, totalQuantity: 31 },
  });
  assert.deepEqual(committed, [
    {
      poNumber: "PO-1",
      supplierId: 1,
      orderDate: new Date("2026-09-22T00:00:00.000Z"),
      expectedDeliveryDate: new Date("2026-09-25T00:00:00.000Z"),
      source: "EXCEL",
      items: { create: [{ productId: 11, quantityOrdered: 30 }] },
    },
    {
      poNumber: "PO-2",
      supplierId: 1,
      orderDate: new Date("2026-09-22T00:00:00.000Z"),
      expectedDeliveryDate: null,
      source: "EXCEL",
      items: { create: [{ productId: 12, quantityOrdered: 1 }] },
    },
  ]);
});

test("orders are inserted in sorted PO number order, whatever the file order", async () => {
  const { db, committed } = fakeDatabase();

  const result = await importPurchaseOrders(db, {
    rows: [row(2, { poNumber: "PO-3" }), row(3, { poNumber: "PO-1" }), row(4, { poNumber: "PO-10" }), row(5, { poNumber: "PO-2" })],
  });

  assert.deepEqual(committed.map((order) => order.poNumber), ["PO-1", "PO-10", "PO-2", "PO-3"]);
  assert.deepEqual(result.imported.map((order) => order.poNumber), ["PO-1", "PO-10", "PO-2", "PO-3"]);
});

test("database lookups run one at a time", async () => {
  let running = 0;
  let mostRunning = 0;
  const lookup = async () => {
    running += 1;
    mostRunning = Math.max(mostRunning, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return [];
  };
  const db = {
    supplier: { findMany: lookup },
    product: { findMany: lookup },
    purchaseOrder: { findMany: lookup },
  } as any;

  const result = await validatePurchaseOrderImport(db, { rows: [row(2)] });

  assert.equal(mostRunning, 1);
  assert.equal(result.valid, false);
});

test("one bad row rejects the whole import and nothing is created", async () => {
  const { db, created, committed } = fakeDatabase();

  await assert.rejects(
    importPurchaseOrders(db, { rows: [row(2), row(3, { poNumber: "PO-2", supplierCode: "SUP-NONE" })] }),
    (error: unknown) =>
      error instanceof ImportRejectedError &&
      messages(error.errors).join() === 'Row 3: supplier "SUP-NONE" was not found',
  );

  assert.deepEqual(created, []);
  assert.deepEqual(committed, []);
});

test("a malformed import request is refused before anything is created", async () => {
  const { db, created } = fakeDatabase();

  await assert.rejects(importPurchaseOrders(db, { rows: [] }), ImportRequestError);
  assert.deepEqual(created, []);
});

test("recognised database conflicts become a conflict error, not a database error", async () => {
  for (const code of ["P2002", "P2003", "P2034"]) {
    const { db, committed } = fakeDatabase({
      failCreate: () => {
        throw Object.assign(new Error("Unique constraint failed: secret database detail"), { code });
      },
    });

    await assert.rejects(
      importPurchaseOrders(db, { rows: [row(2)] }),
      (error: unknown) =>
        error instanceof ImportConflictError &&
        !error.message.includes("secret") &&
        /nothing was saved/.test(error.message),
      code,
    );
    assert.deepEqual(committed, []);
  }
});

test("other database errors are passed on for the route to hide", async () => {
  const failure = Object.assign(new Error("connection lost"), { code: "P1001" });
  const { db } = fakeDatabase({
    failCreate: () => {
      throw failure;
    },
  });

  await assert.rejects(importPurchaseOrders(db, { rows: [row(2)] }), (error: unknown) => error === failure);
});
