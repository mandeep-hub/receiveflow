// Excel purchase order import through the real API and database, on
// receiveflow_test only (same guard, helper and app checks as auth.test.ts).
// Every record carries this run's tag and is removed by exact id.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { importPurchaseOrders } from "../src/purchaseOrders/excelImport.ts";
import { disconnectTestDatabase, getTestDatabase } from "./db.ts";
import {
  authHeaders,
  cleanupTrackedRecords,
  createProduct,
  createPurchaseOrder,
  createSupplier,
  createTestUser,
  createTracker,
  loginAs,
  randomTestPassword,
  type TestDatabase,
  type TestSession,
} from "./fixtures.ts";
import { request } from "./unit/helpers.ts";

const TEST_DATABASE_NAME = "receiveflow_test";
const VALIDATE = "/purchase-orders/import/validate";
const IMPORT = "/purchase-orders/import";

const tracker = createTracker();
const tag = tracker.tag;

let db: TestDatabase;
let databaseReady = false;
let appPrisma: { $disconnect(): Promise<void> } | undefined;
let server: Server | undefined;
let baseUrl = "";
let serverPort = 0;
let adminSession: TestSession;
let warehouseSession: TestSession;
let supplierId: number;
let supplierCode: string;
let inactiveSupplierCode: string;
let firstArticle: string;
let secondArticle: string;
let inactiveArticle: string;
let firstProductId: number;

before(async () => {
  db = await getTestDatabase();
  databaseReady = true;

  const { default: app } = await import("../src/app.js");
  const { default: prisma } = await import("../src/lib/prisma.js");
  appPrisma = prisma;

  const appDatabase = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `;
  if (appDatabase[0]?.current_database !== TEST_DATABASE_NAME) {
    throw new Error(`[import test] The app is not connected to "${TEST_DATABASE_NAME}"; stopping`);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve).once("error", reject);
  });
  serverPort = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${serverPort}`;

  const admin = await createTestUser(db, tracker, { label: "admin", role: "ADMIN", password: randomTestPassword() });
  const warehouse = await createTestUser(db, tracker, { label: "warehouse", role: "WAREHOUSE", password: randomTestPassword() });
  adminSession = await loginAs(baseUrl, admin);
  warehouseSession = await loginAs(baseUrl, warehouse);

  const supplier = await createSupplier(db, tracker, { suffix: "SUP" });
  const inactiveSupplier = await createSupplier(db, tracker, { suffix: "SUP-OLD", active: false });
  const firstProduct = await createProduct(db, tracker, { suffix: "ART-1" });
  const secondProduct = await createProduct(db, tracker, { suffix: "ART-2" });
  const inactiveProduct = await createProduct(db, tracker, { suffix: "ART-OLD", active: false });

  supplierId = supplier.id;
  supplierCode = supplier.code;
  inactiveSupplierCode = inactiveSupplier.code;
  firstProductId = firstProduct.id;
  firstArticle = firstProduct.articleNumber;
  secondArticle = secondProduct.articleNumber;
  inactiveArticle = inactiveProduct.articleNumber;
});

after(async () => {
  try {
    if (databaseReady) {
      // Includes anything a failing test saved by mistake.
      const orders = await db.purchaseOrder.findMany({
        where: { poNumber: { startsWith: `${tag}-` } },
        select: { id: true },
      });
      tracker.purchaseOrderIds.splice(0, tracker.purchaseOrderIds.length, ...orders.map((order) => order.id));

      const result = await cleanupTrackedRecords(db, tracker);
      console.log(`[import test] cleanup: ${JSON.stringify(result)}`);
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await appPrisma?.$disconnect();
    await disconnectTestDatabase();
  }
});

function row(rowNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    rowNumber,
    poNumber: `${tag}-PO`,
    supplierCode,
    articleNumber: firstArticle,
    quantityOrdered: 5,
    orderDate: "2026-09-22",
    expectedDeliveryDate: null,
    ...overrides,
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = authHeaders(adminSession)) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

function orderCount(poNumbers: string[]) {
  return db.purchaseOrder.count({ where: { poNumber: { in: poNumbers } } });
}

test("both routes need a session, the ADMIN role and the CSRF token", async () => {
  const poNumber = `${tag}-AUTH`;
  const rows = [row(2, { poNumber })];

  for (const path of [VALIDATE, IMPORT]) {
    assert.equal((await post(path, { rows }, {})).status, 401, `${path} without a session`);
    assert.equal((await post(path, { rows }, authHeaders(warehouseSession))).status, 403, `${path} as WAREHOUSE`);
    assert.equal((await post(path, { rows }, { Cookie: adminSession.cookie })).status, 403, `${path} without CSRF`);
  }

  assert.equal(await orderCount([poNumber]), 0);
});

test("both routes refuse a foreign Origin, even with a valid ADMIN session and CSRF token", async () => {
  const poNumber = `${tag}-ORIGIN`;

  for (const path of [VALIDATE, IMPORT]) {
    for (const origin of ["https://evil.example", "null"]) {
      const response = await request(serverPort, path, {
        method: "POST",
        headers: { ...authHeaders(adminSession), Origin: origin },
        body: { rows: [row(2, { poNumber })] },
      });

      assert.equal(response.status, 403, `${path} from ${origin}`);
      assert.deepEqual(response.body, { error: "Origin not allowed" }, `${path} from ${origin}`);
    }
  }

  assert.equal(await orderCount([poNumber]), 0);
});

test("validate returns a grouped preview and saves nothing", async () => {
  const poNumber = `${tag}-PREVIEW`;

  const response = await post(VALIDATE, {
    rows: [
      row(2, { poNumber, quantityOrdered: 5 }),
      row(3, { poNumber, quantityOrdered: 25 }),
      row(4, { poNumber, articleNumber: secondArticle, quantityOrdered: 1 }),
    ],
  });

  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.valid, true);
  assert.deepEqual(response.body.errors, []);
  assert.deepEqual(response.body.summary, { purchaseOrders: 1, items: 2, rows: 3, totalQuantity: 31 });
  assert.deepEqual(
    response.body.orders[0].items.map((item: { quantityOrdered: number; rowNumbers: number[] }) => [item.quantityOrdered, item.rowNumbers]),
    [[30, [2, 3]], [1, [4]]],
  );
  assert.equal(await orderCount([poNumber]), 0);
});

test("validate reports invalid suppliers, products, dates and quantities with row numbers", async () => {
  const poNumber = `${tag}-INVALID`;

  const response = await post(VALIDATE, {
    rows: [
      row(2, { poNumber: `${poNumber}-1`, supplierCode: `${tag}-NONE` }),
      row(3, { poNumber: `${poNumber}-2`, supplierCode: inactiveSupplierCode }),
      row(4, { poNumber: `${poNumber}-3`, articleNumber: `${tag}-NONE` }),
      row(5, { poNumber: `${poNumber}-4`, articleNumber: inactiveArticle }),
      row(6, { poNumber: `${poNumber}-5`, orderDate: "2026-02-30" }),
      row(7, { poNumber: `${poNumber}-6`, quantityOrdered: 0 }),
    ],
  });

  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.valid, false);
  assert.equal(response.body.summary, null);
  assert.deepEqual(
    response.body.errors.map((error: { rowNumber: number }) => error.rowNumber),
    [2, 3, 4, 5, 6, 7],
  );
  assert.match(response.body.errors[0].message, /^Row 2: supplier .* was not found$/);
  assert.match(response.body.errors[1].message, /^Row 3: supplier .* is inactive$/);
  assert.match(response.body.errors[2].message, /^Row 4: item .* was not found$/);
  assert.match(response.body.errors[3].message, /^Row 5: item .* is inactive$/);
  assert.match(response.body.errors[4].message, /^Row 6: Order Date/);
  assert.match(response.body.errors[5].message, /^Row 7: Ordered/);
});

test("rows of one PO that disagree on supplier or date are reported", async () => {
  const poNumber = `${tag}-MIXED`;

  const response = await post(VALIDATE, {
    rows: [
      row(2, { poNumber }),
      row(3, { poNumber, orderDate: "2026-09-23" }),
    ],
  });

  assert.equal(response.body.valid, false);
  assert.match(response.body.errors[0].message, /^Row 3: Order Date "2026-09-23" differs from "2026-09-22" on row 2/);
});

test("a malformed request gets 400 from both routes", async () => {
  for (const path of [VALIDATE, IMPORT]) {
    assert.equal((await post(path, { rows: "x" })).status, 400, path);
    assert.equal((await post(path, { rows: [] })).status, 400, path);
    assert.equal((await post(path, {})).status, 400, path);

    const tooMany = Array.from({ length: 501 }, (_, index) => row(index + 2));
    const response = await post(path, { rows: tooMany });
    assert.equal(response.status, 400, path);
    assert.match(response.body.error, /at most 500 data rows/);
  }
});

test("a full 500-row request fits the route's body limit", async () => {
  const rows = Array.from({ length: 500 }, (_, index) => row(index + 2, { poNumber: `${tag}-LARGE-${index}` }));
  const response = await post(VALIDATE, { rows });

  assert.equal(response.status, 200, response.text.slice(0, 200));
  assert.equal(response.body.valid, true);
  assert.equal(response.body.summary.purchaseOrders, 500);
});

test("import saves all orders as EXCEL with combined quantities and midnight UTC dates", async () => {
  const first = `${tag}-SAVE-1`;
  const second = `${tag}-SAVE-2`;

  const response = await post(IMPORT, {
    rows: [
      row(2, { poNumber: first, quantityOrdered: 5, expectedDeliveryDate: "2026-09-25" }),
      row(3, { poNumber: first, quantityOrdered: 25, expectedDeliveryDate: "2026-09-25" }),
      row(4, { poNumber: first, articleNumber: secondArticle, quantityOrdered: 2, expectedDeliveryDate: "2026-09-25" }),
      row(5, { poNumber: second, quantityOrdered: 1 }),
    ],
  });

  assert.equal(response.status, 201, response.text);
  assert.deepEqual(response.body.summary, { purchaseOrders: 2, items: 3, rows: 4, totalQuantity: 33 });
  assert.deepEqual(
    response.body.imported.map((order: { poNumber: string; items: number; totalQuantity: number }) => [order.poNumber, order.items, order.totalQuantity]),
    [[first, 2, 32], [second, 1, 1]],
  );

  const saved = await db.purchaseOrder.findUniqueOrThrow({
    where: { poNumber: first },
    include: { items: { orderBy: { id: "asc" } } },
  });

  assert.equal(saved.source, "EXCEL");
  assert.equal(saved.status, "OPEN");
  assert.equal(saved.supplierId, supplierId);
  assert.equal(saved.orderDate.toISOString(), "2026-09-22T00:00:00.000Z");
  assert.equal(saved.expectedDeliveryDate?.toISOString(), "2026-09-25T00:00:00.000Z");
  assert.deepEqual(saved.items.map((item) => item.quantityOrdered), [30, 2]);
  assert.equal(saved.items[0].productId, firstProductId);

  const other = await db.purchaseOrder.findUniqueOrThrow({ where: { poNumber: second } });
  assert.equal(other.expectedDeliveryDate, null);
});

test("an existing PO number rejects the whole file and saves nothing", async () => {
  const existing = `${tag}-EXISTING`;
  const fresh = `${tag}-NOT-SAVED`;
  await createPurchaseOrder(db, tracker, { suffix: "EXISTING", supplierId, productId: firstProductId, quantityOrdered: 3 });
  const rows = [row(2, { poNumber: fresh }), row(3, { poNumber: existing })];

  const validated = await post(VALIDATE, { rows });
  assert.equal(validated.body.valid, false);
  assert.match(validated.body.errors[0].message, /^Row 3: PO number .* already exists$/);

  const imported = await post(IMPORT, { rows });
  assert.equal(imported.status, 422, imported.text);
  assert.match(imported.body.errors[0].message, /^Row 3: PO number .* already exists$/);
  assert.equal(await orderCount([fresh]), 0);
});

test("one invalid row among valid ones saves nothing", async () => {
  const fresh = `${tag}-PARTIAL-1`;
  const bad = `${tag}-PARTIAL-2`;

  const response = await post(IMPORT, {
    rows: [
      row(2, { poNumber: fresh }),
      row(3, { poNumber: bad, articleNumber: `${tag}-NONE` }),
    ],
  });

  assert.equal(response.status, 422, response.text);
  assert.match(response.body.errors[0].message, /^Row 3: item .* was not found$/);
  assert.equal(await orderCount([fresh, bad]), 0);
});

test("when the second insert fails, the real transaction rolls back the first order too", async () => {
  const first = `${tag}-ROLLBACK-1`;
  const second = `${tag}-ROLLBACK-2`;
  const failure = new Error("forced failure on the second insert");
  let inserted = 0;

  // The real transaction on the guarded test client, with one insert made to fail.
  const failingOnSecondInsert = {
    $transaction: (callback: (tx: any) => Promise<unknown>, options: { timeout: number }) =>
      db.$transaction(
        (tx) =>
          callback({
            supplier: tx.supplier,
            product: tx.product,
            purchaseOrder: {
              findMany: (args: any) => tx.purchaseOrder.findMany(args),
              create: async (args: any) => {
                if (inserted === 1) {
                  throw failure;
                }

                const created = await tx.purchaseOrder.create(args);
                inserted += 1;
                return created;
              },
            },
          }),
        options,
      ),
  } as never;

  await assert.rejects(
    importPurchaseOrders(failingOnSecondInsert, {
      rows: [row(2, { poNumber: first }), row(3, { poNumber: second, articleNumber: secondArticle })],
    }),
    (error: unknown) => error === failure,
  );

  assert.equal(inserted, 1, "the first order was inserted before the failure");
  assert.equal(await orderCount([first, second]), 0, "neither order was kept");
  assert.equal(await db.purchaseOrderItem.count({ where: { purchaseOrder: { poNumber: { in: [first, second] } } } }), 0);
});

test("importing the same file twice at once saves it only once, with no partial data", async () => {
  const first = `${tag}-RACE-1`;
  const second = `${tag}-RACE-2`;
  const rows = [row(2, { poNumber: first }), row(3, { poNumber: second })];

  const responses = await Promise.all([post(IMPORT, { rows }), post(IMPORT, { rows })]);
  const statuses = responses.map((response) => response.status).sort();

  assert.equal(statuses[0], 201, JSON.stringify(statuses));
  assert.ok(statuses[1] === 409 || statuses[1] === 422, JSON.stringify(statuses));
  assert.equal(await orderCount([first, second]), 2);
  assert.equal(await db.purchaseOrderItem.count({ where: { purchaseOrder: { poNumber: { in: [first, second] } } } }), 2);

  const refused = responses.find((response) => response.status !== 201)!;
  assert.ok(!/prisma|constraint|P20\d\d|unique/i.test(refused.text), "no database details in the reply");
});
