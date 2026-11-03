// User management against the real app, on receiveflow_test only (same guard,
// helper and app checks as auth.test.ts). Test users are tagged with this run's
// tag and removed, with their sessions, by exact id.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createWarehouseUser,
  deactivateUser,
  listUsers,
  reactivateUser,
  resetUserPassword,
  UserAdminError,
} from "../src/auth/userAdmin.ts";
import { verifyPassword } from "../src/auth/password.ts";
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

const tracker = createTracker();

let db: TestDatabase;
let databaseReady = false;
let appPrisma: { $disconnect(): Promise<void> } | undefined;
let server: Server | undefined;
let baseUrl = "";

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
    throw new Error(`[user admin test] The app is not connected to "${TEST_DATABASE_NAME}"; stopping`);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve).once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    if (databaseReady) {
      const result = await cleanupTrackedRecords(db, tracker);
      console.log(`[user admin test] cleanup: ${JSON.stringify(result)}`);
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

function taggedEmail(label: string) {
  return `${tracker.tag.toLowerCase()}-${label}@example.invalid`;
}

// A WAREHOUSE user made by the code under test, tracked for cleanup.
async function createManagedUser(label: string) {
  const password = randomTestPassword();
  const user = await createWarehouseUser(db, { email: taggedEmail(label), password });
  tracker.userIds.push(user.id);

  return { id: user.id, email: user.email, password };
}

async function attemptLogin(email: string, password: string) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  return response.status;
}

async function sessionStatus(session: TestSession) {
  return (await fetch(`${baseUrl}/auth/me`, { headers: authHeaders(session) })).status;
}

async function adminWithSession(label: string) {
  const admin = await createTestUser(db, tracker, { label, role: "ADMIN", password: randomTestPassword() });

  return { admin, session: await loginAs(baseUrl, admin) };
}

test("create makes an active WAREHOUSE user with a hashed password, who can log in", async () => {
  const user = await createManagedUser("created");
  const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });

  assert.equal(stored.role, "WAREHOUSE");
  assert.equal(stored.active, true);
  assert.match(stored.passwordHash, /^\$argon2id\$/);
  assert.ok(!stored.passwordHash.includes(user.password));
  assert.equal(await sessionStatus(await loginAs(baseUrl, user)), 200);
});

test("create normalizes the email and refuses one that already exists, changing nothing", async () => {
  const user = await createManagedUser("duplicate");
  const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });

  await assert.rejects(
    createWarehouseUser(db, { email: `  ${user.email.toUpperCase()} `, password: randomTestPassword() }),
    (error: unknown) => error instanceof UserAdminError && /already exists/.test(error.message),
  );

  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), before);
});

test("reset changes the password and ends only that user's sessions", async () => {
  const user = await createManagedUser("reset");
  const other = await createManagedUser("reset-other");
  const session = await loginAs(baseUrl, user);
  const otherSession = await loginAs(baseUrl, other);
  const newPassword = randomTestPassword();

  const result = await resetUserPassword(db, { email: user.email, password: newPassword });

  assert.deepEqual(result, { email: user.email, role: "WAREHOUSE", sessionsEnded: 1 });
  assert.equal(await sessionStatus(session), 401, "the old session has ended");
  assert.equal(await attemptLogin(user.email, user.password), 401, "the old password no longer works");
  assert.equal(await attemptLogin(user.email, newPassword), 200, "the new password works");
  assert.equal(await sessionStatus(otherSession), 200, "another user's session is untouched");
});

test("deactivate blocks login and ends only that user's sessions", async () => {
  const user = await createManagedUser("deactivated");
  const other = await createManagedUser("deactivated-other");
  const session = await loginAs(baseUrl, user);
  const otherSession = await loginAs(baseUrl, other);

  const result = await deactivateUser(db, { email: user.email });

  assert.deepEqual(result, { email: user.email, role: "WAREHOUSE", sessionsEnded: 1 });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active, false);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  assert.equal(await sessionStatus(session), 401);
  assert.equal(await attemptLogin(user.email, user.password), 401);
  assert.equal(await sessionStatus(otherSession), 200, "another user's session is untouched");
});

test("a deactivated user can't be deactivated again or have a password reset", async () => {
  const user = await createManagedUser("already-inactive");
  await deactivateUser(db, { email: user.email });
  const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });

  for (const attempt of [
    () => deactivateUser(db, { email: user.email }),
    () => resetUserPassword(db, { email: user.email, password: randomTestPassword() }),
  ]) {
    await assert.rejects(attempt(), (error: unknown) => error instanceof UserAdminError && /deactivated/.test(error.message));
  }

  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), before);
});

test("ADMIN accounts are refused: password, active flag and sessions stay unchanged", async () => {
  const { admin, session } = await adminWithSession("protected-admin");
  const before = await db.user.findUniqueOrThrow({ where: { id: admin.id } });

  for (const attempt of [
    () => resetUserPassword(db, { email: admin.email, password: randomTestPassword() }),
    () => deactivateUser(db, { email: admin.email }),
  ]) {
    await assert.rejects(attempt(), (error: unknown) => error instanceof UserAdminError && /only WAREHOUSE users/.test(error.message));
  }

  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: admin.id } }), before);
  assert.ok(await verifyPassword(before.passwordHash, admin.password));
  assert.equal(await sessionStatus(session), 200);
});

test("an unknown email is refused", async () => {
  for (const attempt of [
    () => resetUserPassword(db, { email: taggedEmail("nobody"), password: randomTestPassword() }),
    () => deactivateUser(db, { email: taggedEmail("nobody") }),
  ]) {
    await assert.rejects(attempt(), (error: unknown) => error instanceof UserAdminError && /no user has this email/.test(error.message));
  }
});

test("reactivate restores login with the old password; an active user is refused", async () => {
  const user = await createManagedUser("reactivated");
  await deactivateUser(db, { email: user.email });
  assert.equal(await attemptLogin(user.email, user.password), 401);

  assert.deepEqual(await reactivateUser(db, { email: user.email }), { email: user.email, role: "WAREHOUSE" });
  assert.equal(await attemptLogin(user.email, user.password), 200);

  await assert.rejects(
    reactivateUser(db, { email: user.email }),
    (error: unknown) => error instanceof UserAdminError && /already active/.test(error.message),
  );
});

test("listUsers returns only id, email, role and active", async () => {
  await createManagedUser("listed");

  for (const user of await listUsers(db)) {
    assert.deepEqual(Object.keys(user).sort(), ["active", "email", "id", "role"]);
  }
});

// --- The /users API routes ---------------------------------------------------

async function callUsers(session: TestSession, method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...authHeaders(session),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

test("an ADMIN can create, reset, deactivate and reactivate a WAREHOUSE user through the API", async () => {
  const { session } = await adminWithSession("api-admin");
  const email = taggedEmail("api-user");
  const password = randomTestPassword();

  const created = await callUsers(session, "POST", "/users", { email: email.toUpperCase(), password });
  assert.equal(created.status, 201, created.text);
  tracker.userIds.push(created.body.id);
  assert.deepEqual(created.body, { id: created.body.id, email, role: "WAREHOUSE", active: true });

  const listed = await callUsers(session, "GET", "/users");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.some((user: { email: string }) => user.email === email));
  assert.ok(!/passwordHash|argon2/.test(listed.text), "the list never includes password hashes");

  const newPassword = randomTestPassword();
  const reset = await callUsers(session, "POST", `/users/${created.body.id}/reset-password`, { password: newPassword });
  assert.equal(reset.status, 200, reset.text);
  assert.ok(!reset.text.includes(newPassword), "the reply never includes the password");
  assert.equal(await attemptLogin(email, password), 401);
  assert.equal(await attemptLogin(email, newPassword), 200);

  const userSession = await loginAs(baseUrl, { email, password: newPassword });
  assert.equal((await callUsers(session, "POST", `/users/${created.body.id}/deactivate`)).status, 200);
  assert.equal(await sessionStatus(userSession), 401, "deactivating ends the user's session");
  assert.equal(await attemptLogin(email, newPassword), 401);

  assert.equal((await callUsers(session, "POST", `/users/${created.body.id}/reactivate`)).status, 200);
  assert.equal(await attemptLogin(email, newPassword), 200);
});

test("the API refuses bad input with 400, duplicates with 409 and unknown users with 404", async () => {
  const { session } = await adminWithSession("api-validation");
  const existing = await createManagedUser("api-existing");
  const good = randomTestPassword();

  for (const body of [{}, { email: existing.email }, { email: 1, password: good }, { email: "bad", password: good }, { email: taggedEmail("api-short"), password: "short" }]) {
    assert.equal((await callUsers(session, "POST", "/users", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await callUsers(session, "POST", "/users", { email: existing.email, password: good })).status, 409);
  assert.equal((await callUsers(session, "POST", `/users/${existing.id}/reset-password`, {})).status, 400);
  assert.equal((await callUsers(session, "POST", `/users/${existing.id}/reset-password`, { password: "short" })).status, 400);
  assert.equal((await callUsers(session, "POST", `/users/${existing.id}/reactivate`)).status, 409);

  for (const id of ["abc", "0", "-1", "1.5", "99999999999"]) {
    assert.equal((await callUsers(session, "POST", `/users/${id}/deactivate`)).status, 400, id);
  }
  assert.equal((await callUsers(session, "POST", "/users/2147480000/deactivate")).status, 404);
});

test("ADMIN accounts can't be changed through the API, including the caller's own", async () => {
  const { admin, session } = await adminWithSession("api-protected");
  const before = await db.user.findUniqueOrThrow({ where: { id: admin.id } });

  for (const [path, body] of [
    [`/users/${admin.id}/reset-password`, { password: randomTestPassword() }],
    [`/users/${admin.id}/deactivate`, undefined],
    [`/users/${admin.id}/reactivate`, undefined],
  ] as const) {
    const response = await callUsers(session, "POST", path, body);
    assert.equal(response.status, 403, path);
    assert.match(response.body.error, /only WAREHOUSE users/i);
  }

  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: admin.id } }), before);
  assert.equal(await sessionStatus(session), 200);
});

test("a WAREHOUSE user gets 403 from the user routes and changes nothing", async () => {
  const worker = await createManagedUser("api-worker");
  const target = await createManagedUser("api-target");
  const workerSession = await loginAs(baseUrl, worker);
  const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
  const email = taggedEmail("api-not-created");

  for (const [method, path, body] of [
    ["GET", "/users", undefined],
    ["POST", "/users", { email, password: randomTestPassword() }],
    ["POST", `/users/${target.id}/reset-password`, { password: randomTestPassword() }],
    ["POST", `/users/${target.id}/deactivate`, undefined],
    ["POST", `/users/${worker.id}/reset-password`, { password: randomTestPassword() }],
  ] as const) {
    assert.equal((await callUsers(workerSession, method, path, body)).status, 403, `${method} ${path}`);
  }

  assert.equal(await db.user.count({ where: { email } }), 0);
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: target.id } }), before);
});

test("the user routes need the CSRF token for changes", async () => {
  const { session } = await adminWithSession("api-csrf");
  const target = await createManagedUser("api-csrf-target");

  const response = await fetch(`${baseUrl}/users/${target.id}/deactivate`, {
    method: "POST",
    headers: { Cookie: session.cookie },
  });

  assert.equal(response.status, 403);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).active, true);
});
