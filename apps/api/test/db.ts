// Test database helper. The only way for tests to get a Prisma client.
//
// It fails closed, in this order, before anything can reach a database:
//   1. The guard marker must exist in this process (set by test/guard.ts,
//      which the `test` script loads with --import) and name receiveflow_test.
//   2. TEST_DATABASE_URL must still target receiveflow_test, and DATABASE_URL
//      (used by the app under test) must still equal it.
//   3. Only then is Prisma imported, and the client is built from
//      TEST_DATABASE_URL alone, never from DATABASE_URL, .env or src/lib/prisma.
//   4. `SELECT current_database()` must return exactly receiveflow_test,
//      otherwise the client is disconnected and every caller gets an error.
//
// Error messages contain fixed text and, at most, an error code: never a URL,
// user name or password.

const TEST_DATABASE_NAME = "receiveflow_test";
const TEST_GUARD_MARKER = Symbol.for("receiveflow.testDatabaseGuard");

type TestPrismaClient = import("../src/generated/prisma/client.js").PrismaClient;

let clientPromise: Promise<TestPrismaClient> | undefined;

function refuse(reason: string): never {
  throw new Error(`[test db] Refusing to use the database: ${reason}`);
}

function assertGuardMarker() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, TEST_GUARD_MARKER);
  const marker = descriptor?.value as { databaseName?: unknown } | undefined;

  if (
    !descriptor ||
    descriptor.writable ||
    descriptor.configurable ||
    !Object.isFrozen(marker) ||
    marker?.databaseName !== TEST_DATABASE_NAME
  ) {
    refuse("the test guard did not run in this process (use `yarn test`)");
  }
}

function guardedTestDatabaseUrl() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    refuse("TEST_DATABASE_URL is not set");
  }

  let databaseName: string;

  try {
    databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  } catch {
    refuse("TEST_DATABASE_URL is not a valid URL");
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    refuse(`TEST_DATABASE_URL must target "${TEST_DATABASE_NAME}"`);
  }

  // The app under test connects through DATABASE_URL, which the guard set.
  if (process.env.DATABASE_URL !== testDatabaseUrl) {
    refuse("DATABASE_URL no longer matches TEST_DATABASE_URL");
  }

  return testDatabaseUrl;
}

function errorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? ` (code ${code})`
    : "";
}

async function connectAndVerify(): Promise<TestPrismaClient> {
  assertGuardMarker();
  const connectionString = guardedTestDatabaseUrl();

  // Imported only after every check above has passed.
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../src/generated/prisma/client.js");

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  let currentDatabase: unknown;

  try {
    const rows = await client.$queryRaw<{ current_database: string }[]>`
      SELECT current_database()
    `;
    currentDatabase = rows[0]?.current_database;
  } catch (error) {
    await client.$disconnect().catch(() => {});
    refuse(`could not verify the connected database${errorCode(error)}`);
  }

  if (currentDatabase !== TEST_DATABASE_NAME) {
    await client.$disconnect().catch(() => {});
    refuse(`the connected database is not "${TEST_DATABASE_NAME}"`);
  }

  return client;
}

// Returns the verified client. All calls share one connection check; if it
// fails, every caller gets the error until disconnectTestDatabase() is called.
export function getTestDatabase(): Promise<TestPrismaClient> {
  clientPromise ??= connectAndVerify();

  return clientPromise;
}

export async function disconnectTestDatabase() {
  if (!clientPromise) {
    return;
  }

  const pending = clientPromise;
  clientPromise = undefined;

  try {
    await (await pending).$disconnect();
  } catch {
    // The connection check failed, so there is nothing to disconnect.
  }
}
