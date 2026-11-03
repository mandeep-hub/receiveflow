// Database-backed tests for POST /receivings. They run against
// receiveflow_test only:
//   - test/guard.ts (loaded by `yarn test`) has already checked the URL and
//     pointed DATABASE_URL at it;
//   - getTestDatabase() verifies the test client's database name;
//   - the app is imported only after that, and its own Prisma client is
//     verified separately, before any test record is created.
// Every record is tagged with this run's tag and cleaned up by exact id.
// Requests are made as a logged-in WAREHOUSE test user (session cookie and
// CSRF token), as the frontend does.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  trackReceiving,
  type PurchaseOrderStatus,
  type TestDatabase,
  type TestSession,
} from "./fixtures.ts";

const TEST_DATABASE_NAME = "receiveflow_test";

const tracker = createTracker();

let db: TestDatabase | undefined;
let appPrisma: { $disconnect(): Promise<void> } | undefined;
let server: Server | undefined;
let baseUrl = "";

type TestPo = { id: number; itemId: number };

let partialPo: TestPo;
let duplicatePo: TestPo;
let fullPo: TestPo;
let draftPo: TestPo;
let cancelledPo: TestPo;
let excessivePo: TestPo;
let overPo: TestPo;

// Each invalid quantity gets its own purchase order (created in before()).
const INVALID_QUANTITIES = [
  ["zero", 0],
  ["negative", -1],
  ["fractional", 1.5],
  ["text", "3"],
] as const;
const invalidQuantityPos = new Map<string, TestPo>();
let reasonPo: TestPo;
let authPo: TestPo;
let warehouseSession: TestSession;

// "session" (default): cookie and CSRF token; "no-csrf": cookie only;
// "none": neither.
async function postReceiving(body: unknown, auth: "session" | "no-csrf" | "none" = "session") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (auth === "session") {
    Object.assign(headers, authHeaders(warehouseSession));
  } else if (auth === "no-csrf") {
    headers.Cookie = warehouseSession.cookie;
  }

  const response = await fetch(`${baseUrl}/receivings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const result = { status: response.status, body: await response.json().catch(() => null) };

  // Track before any assertion, so a failing test can't leave an untracked row.
  trackReceiving(tracker, result);

  return result;
}

// Checks a PO's saved state in the database: its number of receivings, the
// total quantity received on its item, and its status. After a rejected
// request, the expected values are the ones from before it, which proves
// nothing was saved and nothing changed.
async function assertPurchaseOrderState(
  po: TestPo,
  expected: { status: PurchaseOrderStatus; receivings: number; totalReceived: number },
) {
  const receivings = await db!.receiving.count({ where: { purchaseOrderId: po.id } });
  assert.equal(receivings, expected.receivings, "number of receivings on the PO");

  const received = await db!.receivingItem.aggregate({
    where: { purchaseOrderItemId: po.itemId },
    _sum: { quantityReceived: true },
  });
  assert.equal(received._sum.quantityReceived ?? 0, expected.totalReceived, "total received");

  const purchaseOrder = await db!.purchaseOrder.findUnique({ where: { id: po.id } });
  assert.equal(purchaseOrder?.status, expected.status, "purchase order status");
}

before(async () => {
  // 1. The test client: guard marker, URL and current_database() are checked here.
  db = await getTestDatabase();

  // 2. The app and its Prisma client, loaded only after step 1 passed.
  const { default: app } = await import("../src/app.js");
  const { default: prisma } = await import("../src/lib/prisma.js");
  appPrisma = prisma;

  const appDatabase = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `;
  if (appDatabase[0]?.current_database !== TEST_DATABASE_NAME) {
    throw new Error(`[receivings test] The app is not connected to "${TEST_DATABASE_NAME}"; stopping`);
  }

  // 3. Start the app on a random local port (never 3000).
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve).once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // 4. A tagged WAREHOUSE user, logged in through the API.
  const warehouse = await createTestUser(db, tracker, {
    label: "warehouse",
    role: "WAREHOUSE",
    password: randomTestPassword(),
  });
  warehouseSession = await loginAs(baseUrl, warehouse);

  // 5. Test records, all tagged with this run's tag.
  const supplier = await createSupplier(db, tracker);
  const product = await createProduct(db, tracker);
  const shared = { supplierId: supplier.id, productId: product.id, quantityOrdered: 10 };

  partialPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "PARTIAL" });
  duplicatePo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "DUPLICATE" });

  // One purchase order per test below, so no test depends on another.
  fullPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "FULL" });
  draftPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "DRAFT", status: "DRAFT" });
  cancelledPo = await createPurchaseOrder(db, tracker, {
    ...shared,
    suffix: "CANCELLED",
    status: "CANCELLED",
  });
  for (const [label] of INVALID_QUANTITIES) {
    invalidQuantityPos.set(
      label,
      await createPurchaseOrder(db, tracker, { ...shared, suffix: `QUANTITY-${label.toUpperCase()}` }),
    );
  }
  excessivePo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "EXCESSIVE" });
  overPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "OVER" });
  reasonPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "REASON" });
  authPo = await createPurchaseOrder(db, tracker, { ...shared, suffix: "AUTH" });
});

after(async () => {
  try {
    if (db) {
      const result = await cleanupTrackedRecords(db, tracker);
      console.log(`[receivings test] cleanup: ${JSON.stringify(result)}`);
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

test("a valid partial receipt is saved and the PO becomes PARTIALLY_RECEIVED", async () => {
  const response = await postReceiving({
    purchaseOrderId: partialPo.id,
    epCount: 1,
    items: [
      { purchaseOrderItemId: partialPo.itemId, quantityReceived: 4, reasonCode: "PARTIAL_DELIVERY" },
    ],
  });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.purchaseOrderId, partialPo.id);
  assert.equal(response.body.epCount, 1);
  assert.equal(response.body.items.length, 1);

  const [item] = response.body.items;
  assert.equal(item.purchaseOrderItemId, partialPo.itemId);
  assert.equal(item.quantityReceived, 4);
  assert.equal(item.reasonCode, "PARTIAL_DELIVERY");
  assert.equal(item.totalReceived, 4);
  assert.equal(item.remainingQuantity, 6);
  assert.equal(item.difference, -6);

  // The database agrees with the response.
  const saved = await db!.receiving.findUnique({
    where: { id: response.body.id },
    include: { items: true },
  });
  assert.ok(saved, "the receiving must be saved");
  assert.equal(saved.purchaseOrderId, partialPo.id);
  assert.deepEqual(
    saved.items.map((i) => [i.purchaseOrderItemId, i.quantityReceived]),
    [[partialPo.itemId, 4]],
  );

  const purchaseOrder = await db!.purchaseOrder.findUnique({ where: { id: partialPo.id } });
  assert.equal(purchaseOrder?.status, "PARTIALLY_RECEIVED");
});

test("a nonexistent purchase order returns 404 and saves no receiving", async () => {
  // Pick an id above every existing purchase order, then confirm it is unused.
  const highest = await db!.purchaseOrder.aggregate({ _max: { id: true } });
  const missingId = (highest._max.id ?? 0) + 1_000_000;
  assert.equal(await db!.purchaseOrder.findUnique({ where: { id: missingId } }), null);

  const response = await postReceiving({
    purchaseOrderId: missingId,
    epCount: 1,
    items: [{ purchaseOrderItemId: 1, quantityReceived: 1 }],
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Purchase order not found" });
  assert.equal(await db!.receiving.count({ where: { purchaseOrderId: missingId } }), 0);
});

test("duplicate items in one request return 400 and save no receiving", async () => {
  const response = await postReceiving({
    purchaseOrderId: duplicatePo.id,
    epCount: 1,
    items: [
      { purchaseOrderItemId: duplicatePo.itemId, quantityReceived: 3, reasonCode: "PARTIAL_DELIVERY" },
      { purchaseOrderItemId: duplicatePo.itemId, quantityReceived: 3, reasonCode: "PARTIAL_DELIVERY" },
    ],
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: `Duplicate purchaseOrderItemId ${duplicatePo.itemId} in request`,
  });
  assert.equal(await db!.receiving.count({ where: { purchaseOrderId: duplicatePo.id } }), 0);

  // A rejected request must not change the purchase order either.
  const purchaseOrder = await db!.purchaseOrder.findUnique({ where: { id: duplicatePo.id } });
  assert.equal(purchaseOrder?.status, "OPEN");
});

test("a full receipt makes the PO RECEIVED, and a further receipt is refused", async () => {
  // Receiving everything that is left needs no reason code.
  const response = await postReceiving({
    purchaseOrderId: fullPo.id,
    epCount: 1,
    items: [{ purchaseOrderItemId: fullPo.itemId, quantityReceived: 10 }],
  });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  const [item] = response.body.items;
  assert.equal(item.quantityReceived, 10);
  assert.equal(item.reasonCode, null);
  assert.equal(item.totalReceived, 10);
  assert.equal(item.remainingQuantity, 0);
  assert.equal(item.difference, 0);
  await assertPurchaseOrderState(fullPo, { status: "RECEIVED", receivings: 1, totalReceived: 10 });

  // The PO is now closed for receiving.
  const again = await postReceiving({
    purchaseOrderId: fullPo.id,
    epCount: 1,
    items: [{ purchaseOrderItemId: fullPo.itemId, quantityReceived: 1, reasonCode: "OTHER" }],
  });

  assert.equal(again.status, 409);
  assert.deepEqual(again.body, {
    error: "Purchase order is not open for receiving (status: RECEIVED)",
  });
  await assertPurchaseOrderState(fullPo, { status: "RECEIVED", receivings: 1, totalReceived: 10 });
});

for (const [label, status] of [
  ["DRAFT", "DRAFT"],
  ["CANCELLED", "CANCELLED"],
] as const) {
  test(`a ${label} PO is refused with 409 and nothing is saved`, async () => {
    const po = status === "DRAFT" ? draftPo : cancelledPo;

    const response = await postReceiving({
      purchaseOrderId: po.id,
      epCount: 1,
      items: [{ purchaseOrderItemId: po.itemId, quantityReceived: 5, reasonCode: "PARTIAL_DELIVERY" }],
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: `Purchase order is not open for receiving (status: ${status})`,
    });
    await assertPurchaseOrderState(po, { status, receivings: 0, totalReceived: 0 });
  });
}

for (const [label, quantityReceived] of INVALID_QUANTITIES) {
  test(`an invalid quantity (${label}) is refused with 400 and nothing is saved`, async () => {
    const po = invalidQuantityPos.get(label)!;

    const response = await postReceiving({
      purchaseOrderId: po.id,
      epCount: 1,
      items: [{ purchaseOrderItemId: po.itemId, quantityReceived, reasonCode: "PARTIAL_DELIVERY" }],
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "Each item must have a quantityReceived greater than 0",
    });
    await assertPurchaseOrderState(po, { status: "OPEN", receivings: 0, totalReceived: 0 });
  });
}

test("more than the ordered quantity is refused with 400 and nothing is saved", async () => {
  const response = await postReceiving({
    purchaseOrderId: excessivePo.id,
    epCount: 1,
    items: [{ purchaseOrderItemId: excessivePo.itemId, quantityReceived: 11 }],
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: `Quantity received exceeds the remaining quantity for purchase order item ${excessivePo.itemId}`,
  });
  await assertPurchaseOrderState(excessivePo, { status: "OPEN", receivings: 0, totalReceived: 0 });
});

test("over-receiving after a partial receipt is refused and the first receipt is kept", async () => {
  const first = await postReceiving({
    purchaseOrderId: overPo.id,
    epCount: 1,
    items: [{ purchaseOrderItemId: overPo.itemId, quantityReceived: 4, reasonCode: "PARTIAL_DELIVERY" }],
  });

  assert.equal(first.status, 201, JSON.stringify(first.body));
  await assertPurchaseOrderState(overPo, { status: "PARTIALLY_RECEIVED", receivings: 1, totalReceived: 4 });

  // Only 6 are left, so 7 is too many.
  const second = await postReceiving({
    purchaseOrderId: overPo.id,
    epCount: 1,
    items: [{ purchaseOrderItemId: overPo.itemId, quantityReceived: 7, reasonCode: "PARTIAL_DELIVERY" }],
  });

  assert.equal(second.status, 400);
  assert.deepEqual(second.body, {
    error: `Quantity received exceeds the remaining quantity for purchase order item ${overPo.itemId}`,
  });
  await assertPurchaseOrderState(overPo, { status: "PARTIALLY_RECEIVED", receivings: 1, totalReceived: 4 });
});

test("a partial delivery without a reason code is refused with 400 and nothing is saved", async () => {
  for (const reasonCode of [undefined, ""]) {
    const response = await postReceiving({
      purchaseOrderId: reasonPo.id,
      epCount: 1,
      items: [{ purchaseOrderItemId: reasonPo.itemId, quantityReceived: 4, reasonCode }],
    });

    assert.equal(response.status, 400, `reasonCode ${JSON.stringify(reasonCode)}`);
    assert.deepEqual(response.body, { error: "reasonCode is required for a partial delivery" });
    await assertPurchaseOrderState(reasonPo, { status: "OPEN", receivings: 0, totalReceived: 0 });
  }
});

test("a receiving without a session is refused with 401 and nothing is saved", async () => {
  const response = await postReceiving(
    {
      purchaseOrderId: authPo.id,
      epCount: 1,
      items: [{ purchaseOrderItemId: authPo.itemId, quantityReceived: 10 }],
    },
    "none",
  );

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: "Authentication required" });
  await assertPurchaseOrderState(authPo, { status: "OPEN", receivings: 0, totalReceived: 0 });
});

test("a receiving with a session but no CSRF token is refused with 403 and nothing is saved", async () => {
  const response = await postReceiving(
    {
      purchaseOrderId: authPo.id,
      epCount: 1,
      items: [{ purchaseOrderItemId: authPo.itemId, quantityReceived: 10 }],
    },
    "no-csrf",
  );

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "Invalid or missing CSRF token" });
  await assertPurchaseOrderState(authPo, { status: "OPEN", receivings: 0, totalReceived: 0 });
});
