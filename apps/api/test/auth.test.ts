// Database-backed authentication tests against the real app, on
// receiveflow_test only (same guard, helper and app checks as
// receivings.test.ts). Test users are tagged with this run's tag and removed,
// with their sessions, by exact id.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hashToken } from "../src/auth/tokens.ts";
import { disconnectTestDatabase, getTestDatabase } from "./db.ts";
import {
  authHeaders,
  cleanupTrackedRecords,
  createTestUser,
  createTracker,
  loginAs,
  randomTestPassword,
  type TestDatabase,
  type TestSession,
} from "./fixtures.ts";

const TEST_DATABASE_NAME = "receiveflow_test";
// An id no row has (int4 range); used where a route must answer 404.
const MISSING_ID = 2_147_480_000;

const tracker = createTracker();

let db: TestDatabase | undefined;
let appPrisma: { $disconnect(): Promise<void> } | undefined;
let server: Server | undefined;
let baseUrl = "";

type TestUser = { id: number; email: string; password: string };
let admin: TestUser;
let warehouse: TestUser;
let inactive: TestUser;
let adminSession: TestSession;
let warehouseSession: TestSession;

async function call(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const headers: Record<string, string> = { ...options.headers };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  return { status: response.status, body: await response.json().catch(() => null) };
}

before(async () => {
  db = await getTestDatabase();

  const { default: app } = await import("../src/app.js");
  const { default: prisma } = await import("../src/lib/prisma.js");
  appPrisma = prisma;

  const appDatabase = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `;
  if (appDatabase[0]?.current_database !== TEST_DATABASE_NAME) {
    throw new Error(`[auth test] The app is not connected to "${TEST_DATABASE_NAME}"; stopping`);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve).once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  admin = await createTestUser(db, tracker, { label: "admin", role: "ADMIN", password: randomTestPassword() });
  warehouse = await createTestUser(db, tracker, {
    label: "warehouse",
    role: "WAREHOUSE",
    password: randomTestPassword(),
  });
  inactive = await createTestUser(db, tracker, {
    label: "inactive",
    role: "WAREHOUSE",
    password: randomTestPassword(),
    active: false,
  });

  adminSession = await loginAs(baseUrl, admin);
  warehouseSession = await loginAs(baseUrl, warehouse);
});

after(async () => {
  try {
    if (db) {
      const result = await cleanupTrackedRecords(db, tracker);
      console.log(`[auth test] cleanup: ${JSON.stringify(result)}`);
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

// Every route of the API except the public ones.
const PROTECTED_ROUTES: [string, string][] = [
  ["GET", "/auth/me"],
  ["POST", "/auth/logout"],
  ["GET", "/suppliers"],
  ["POST", "/suppliers"],
  ["GET", `/suppliers/${MISSING_ID}`],
  ["PUT", `/suppliers/${MISSING_ID}`],
  ["DELETE", `/suppliers/${MISSING_ID}`],
  ["GET", "/products"],
  ["POST", "/products"],
  ["GET", `/products/${MISSING_ID}`],
  ["PUT", `/products/${MISSING_ID}`],
  ["DELETE", `/products/${MISSING_ID}`],
  ["POST", "/purchase-orders"],
  ["GET", "/purchase-orders"],
  ["GET", `/purchase-orders/${MISSING_ID}`],
  ["POST", `/purchase-orders/${MISSING_ID}/recalculate-status`],
  ["POST", "/receivings"],
  ["GET", "/receivings"],
  ["GET", "/receivings/report?date=2026-01-01"],
  ["GET", `/receivings/${MISSING_ID}`],
];

test("public routes stay public", async () => {
  assert.equal((await call("GET", "/")).status, 200);
  assert.equal((await call("GET", "/health")).status, 200);
});

test("every other route returns 401 without a session", async () => {
  for (const [method, path] of PROTECTED_ROUTES) {
    const response = await call(method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.deepEqual(response.body, { error: "Authentication required" }, `${method} ${path}`);
  }
});

test("passwords are stored as Argon2id hashes and sessions only as SHA-256 token hashes", async () => {
  const stored = await db!.user.findUnique({ where: { id: admin.id } });
  const [, algorithm, version, parameters] = stored!.passwordHash.split("$");
  assert.equal(algorithm, "argon2id");
  assert.equal(version, "v=19");
  assert.deepEqual(
    Object.fromEntries(parameters.split(",").map((pair) => pair.split("="))),
    { m: "19456", t: "2", p: "1" },
  );
  assert.ok(!stored!.passwordHash.includes(admin.password));

  const sessions = await db!.session.findMany({ where: { userId: warehouse.id } });
  assert.ok(sessions.some((s) => s.tokenHash === hashToken(warehouseSession.token)));
  assert.ok(sessions.every((s) => /^[0-9a-f]{64}$/.test(s.tokenHash)));
  assert.ok(sessions.every((s) => s.tokenHash !== warehouseSession.token));
  assert.equal(await db!.session.count({ where: { tokenHash: warehouseSession.token } }), 0);
});

test("WAREHOUSE gets 403 on every ADMIN route, even with valid input, and nothing is written", async () => {
  const code = `${tracker.tag}-W`;
  const requests: [string, string, unknown][] = [
    ["POST", "/suppliers", { code, name: "should not be created" }],
    ["PUT", `/suppliers/${MISSING_ID}`, { name: "x" }],
    ["DELETE", `/suppliers/${MISSING_ID}`, undefined],
    ["POST", "/products", { articleNumber: code, name: "should not be created" }],
    ["PUT", `/products/${MISSING_ID}`, { name: "x" }],
    ["DELETE", `/products/${MISSING_ID}`, undefined],
    ["POST", "/purchase-orders", { poNumber: code }],
    ["POST", `/purchase-orders/${MISSING_ID}/recalculate-status`, undefined],
  ];

  for (const [method, path, body] of requests) {
    const response = await call(method, path, { headers: authHeaders(warehouseSession), body });

    // Track anything created by mistake, so cleanup still finds it.
    if (response.status === 201 && Number.isInteger(response.body?.id)) {
      if (path === "/suppliers") tracker.supplierIds.push(response.body.id);
      if (path === "/products") tracker.productIds.push(response.body.id);
      if (path === "/purchase-orders") tracker.purchaseOrderIds.push(response.body.id);
    }

    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(response.body, { error: "You do not have permission to do this" });
  }

  assert.equal(await db!.supplier.count({ where: { code } }), 0);
  assert.equal(await db!.product.count({ where: { articleNumber: code } }), 0);
  assert.equal(await db!.purchaseOrder.count({ where: { poNumber: code } }), 0);
});

test("ADMIN passes the role check on every ADMIN route (validation or 404 answers next)", async () => {
  const requests: [string, string, unknown, number][] = [
    ["POST", "/suppliers", {}, 400],
    ["PUT", `/suppliers/${MISSING_ID}`, { name: "x" }, 404],
    ["DELETE", `/suppliers/${MISSING_ID}`, undefined, 404],
    ["POST", "/products", {}, 400],
    ["PUT", `/products/${MISSING_ID}`, { name: "x" }, 404],
    ["DELETE", `/products/${MISSING_ID}`, undefined, 404],
    ["POST", "/purchase-orders", {}, 400],
    ["POST", `/purchase-orders/${MISSING_ID}/recalculate-status`, undefined, 404],
  ];

  for (const [method, path, body, expected] of requests) {
    const response = await call(method, path, { headers: authHeaders(adminSession), body });
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(response.body)}`);
  }
});

test("WAREHOUSE can read purchase orders, receivings and reports", async () => {
  for (const path of ["/purchase-orders", "/receivings", "/receivings/report?date=2026-01-01", "/suppliers", "/products"]) {
    const response = await call("GET", path, { headers: authHeaders(warehouseSession) });
    assert.equal(response.status, 200, path);
  }
});

test("/auth/me returns the user and role, never the password hash", async () => {
  const response = await call("GET", "/auth/me", { headers: authHeaders(adminSession) });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.user, { email: admin.email, role: "ADMIN" });
  assert.equal(response.body.csrfToken, adminSession.csrfToken);
  assert.ok(!JSON.stringify(response.body).includes("passwordHash"));
});

test("an inactive user and a wrong password get the same generic 401", async () => {
  for (const credentials of [
    { email: inactive.email, password: inactive.password },
    { email: warehouse.email, password: "wrong-password" },
  ]) {
    const response = await call("POST", "/auth/login", { body: credentials });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "Invalid email or password" });
  }
});

test("logout deletes the session row and the old cookie stops working", async () => {
  const session = await loginAs(baseUrl, warehouse);
  assert.equal(await db!.session.count({ where: { tokenHash: hashToken(session.token) } }), 1);

  const response = await call("POST", "/auth/logout", { headers: authHeaders(session) });
  assert.equal(response.status, 204);
  assert.equal(await db!.session.count({ where: { tokenHash: hashToken(session.token) } }), 0);
  assert.equal((await call("GET", "/auth/me", { headers: authHeaders(session) })).status, 401);
});

test("an expired session is refused and removed", async () => {
  const session = await loginAs(baseUrl, warehouse);
  await db!.session.update({
    where: { tokenHash: hashToken(session.token) },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  assert.equal((await call("GET", "/auth/me", { headers: authHeaders(session) })).status, 401);
  assert.equal(await db!.session.count({ where: { tokenHash: hashToken(session.token) } }), 0);
});

test("deactivating a user ends their existing session", async () => {
  const user = await createTestUser(db!, tracker, {
    label: "deactivated",
    role: "WAREHOUSE",
    password: randomTestPassword(),
  });
  const session = await loginAs(baseUrl, user);
  assert.equal((await call("GET", "/auth/me", { headers: authHeaders(session) })).status, 200);

  await db!.user.update({ where: { id: user.id }, data: { active: false } });
  assert.equal((await call("GET", "/auth/me", { headers: authHeaders(session) })).status, 401);
});
