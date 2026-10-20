// Test database guard. Loaded with `--import` before every test file, and so
// before the app or the Prisma client can be imported. It fails closed: any
// doubt about the target database stops the run before a connection is made.
//
// It deliberately imports nothing, and its error messages contain only fixed
// text: nothing taken from a URL or a configured host list is ever printed.
//
// Host policy: the database host must be in TEST_DATABASE_ALLOWED_HOSTS, a
// comma-separated list of plain host names. When it is unset, only local hosts
// are allowed (localhost, 127.0.0.1, [::1]), which also covers a GitHub Actions
// PostgreSQL service mapped to localhost. Setting the variable replaces the
// default list, e.g. TEST_DATABASE_ALLOWED_HOSTS=postgres for a container job.
//
// On success the guard sets DATABASE_URL to the test URL and publishes a
// process-local marker (see TEST_GUARD_MARKER). The database helper must check
// that marker and then confirm `SELECT current_database()` on a real
// connection before any database-backed test runs.

const TEST_DATABASE_NAME = "receiveflow_test";
const DEVELOPMENT_DATABASE_NAME = "receiveflow";
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// Query parameters that the PostgreSQL client could use to connect somewhere
// other than the host and database named in the URL itself.
const FORBIDDEN_QUERY_PARAMETERS = ["database", "dbname", "host", "hostaddr", "port"];

// A plain DNS host name or a bracketed IPv6 address. No ports, credentials,
// paths or wildcards.
const HOST_ENTRY_PATTERN =
  /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/;

// Symbol.for() keys can't be set through the environment or another process,
// so the marker proves this guard ran in the current process.
export const TEST_GUARD_MARKER = Symbol.for("receiveflow.testDatabaseGuard");

function refuse(reason: string): never {
  process.stderr.write(`[test guard] Refusing to run tests: ${reason}\n`);
  process.exit(1);
}

function allowedHosts() {
  const configured = process.env.TEST_DATABASE_ALLOWED_HOSTS;

  if (configured === undefined) {
    return DEFAULT_ALLOWED_HOSTS;
  }

  const hosts = configured.split(",").map((host) => host.trim().toLowerCase());

  if (hosts.some((host) => !HOST_ENTRY_PATTERN.test(host))) {
    refuse(
      "TEST_DATABASE_ALLOWED_HOSTS must be a comma-separated list of plain host names",
    );
  }

  return hosts;
}

const hosts = allowedHosts();
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  refuse("TEST_DATABASE_URL is not set");
}

let url: URL;

try {
  url = new URL(testDatabaseUrl);
} catch {
  refuse("TEST_DATABASE_URL is not a valid URL");
}

if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
  refuse("TEST_DATABASE_URL must be a postgresql:// URL");
}

for (const key of url.searchParams.keys()) {
  if (FORBIDDEN_QUERY_PARAMETERS.includes(key.toLowerCase())) {
    refuse(
      "TEST_DATABASE_URL must not use query parameters that change the host, port or database",
    );
  }
}

// postgresql: is not a "special" URL scheme, so URL keeps the host exactly as
// written (no lower-casing or IP normalization). Compare case-insensitively;
// shortened or numeric IP forms simply don't match the allowed list.
if (!hosts.includes(url.hostname.toLowerCase())) {
  refuse(
    "TEST_DATABASE_URL host is not allowed (see TEST_DATABASE_ALLOWED_HOSTS)",
  );
}

// Compare the raw path, so encoded or decorated names are rejected too.
const databaseName = url.pathname.slice(1);

if (databaseName === DEVELOPMENT_DATABASE_NAME) {
  refuse(
    `TEST_DATABASE_URL targets the development database "${DEVELOPMENT_DATABASE_NAME}"`,
  );
}

if (databaseName !== TEST_DATABASE_NAME) {
  refuse(`TEST_DATABASE_URL must target "${TEST_DATABASE_NAME}"`);
}

// dotenv never overrides a variable that is already set, so setting
// DATABASE_URL here keeps .env from pointing the app at another database.
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl !== undefined && databaseUrl !== testDatabaseUrl) {
  refuse("DATABASE_URL is set to a different database than TEST_DATABASE_URL");
}

process.env.DATABASE_URL = testDatabaseUrl;

Object.defineProperty(globalThis, TEST_GUARD_MARKER, {
  value: Object.freeze({ databaseName: TEST_DATABASE_NAME }),
  enumerable: false,
  writable: false,
  configurable: false,
});
