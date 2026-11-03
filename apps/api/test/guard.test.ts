// Checks the test database guard in isolated child processes. No database
// connection is made: every URL is a dummy, and the child only runs the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiDir = fileURLToPath(new URL("..", import.meta.url));

// Never real credentials; checked to be absent from all guard output.
const DUMMY_USER = "guard_user";
const DUMMY_PASSWORD = "dummy-guard-secret";
const CREDENTIALS = `${DUMMY_USER}:${DUMMY_PASSWORD}`;

const urlFor = (host: string, path = "receiveflow_test", scheme = "postgresql") =>
  `${scheme}://${CREDENTIALS}@${host}/${path}`;

const SAFE_URL = urlFor("127.0.0.1:5432");
const DEV_URL = urlFor("127.0.0.1:5432", "receiveflow");

// Runs only the guard, then reports what it left behind.
const CHILD_SCRIPT = `
const marker = globalThis[Symbol.for("receiveflow.testDatabaseGuard")];
console.log("GUARD_PASSED");
console.log("DATABASE_URL_MATCHES_TEST=" + (process.env.DATABASE_URL === process.env.TEST_DATABASE_URL));
console.log("MARKER=" + JSON.stringify(marker));
console.log("MARKER_FROZEN=" + Object.isFrozen(marker));
`;

type GuardEnv = {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
  TEST_DATABASE_ALLOWED_HOSTS?: string;
};

function runGuard(env: GuardEnv) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };

  // Start from a clean slate: nothing inherited from the parent run.
  delete childEnv.TEST_DATABASE_URL;
  delete childEnv.DATABASE_URL;
  delete childEnv.TEST_DATABASE_ALLOWED_HOSTS;
  delete childEnv.NODE_TEST_CONTEXT;
  Object.assign(childEnv, env);

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./test/guard.ts",
      "--input-type=module",
      "--eval",
      CHILD_SCRIPT,
    ],
    { cwd: apiDir, env: childEnv, encoding: "utf8", timeout: 30_000 },
  );

  const output = `${result.stdout}${result.stderr}`;

  for (const secret of [DUMMY_PASSWORD, DUMMY_USER]) {
    assert.ok(!output.includes(secret), "guard output must never contain URL credentials");
  }

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// mustNotEcho: URL-derived text that must not appear in the error message.
function assertRefused(env: GuardEnv, expectedReason: RegExp, mustNotEcho: string[] = []) {
  const result = runGuard(env);

  assert.notEqual(result.status, 0, "guard must exit non-zero");
  assert.match(result.stderr, /\[test guard\] Refusing to run tests: /);
  assert.match(result.stderr, expectedReason);
  assert.ok(!result.stdout.includes("GUARD_PASSED"), "code after the guard must not run");

  for (const text of mustNotEcho) {
    assert.ok(!result.stderr.includes(text), `error must not echo "${text}"`);
  }
}

function assertPassed(env: GuardEnv) {
  const result = runGuard(env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GUARD_PASSED/);
  assert.match(result.stdout, /DATABASE_URL_MATCHES_TEST=true/);
  assert.match(result.stdout, /MARKER=\{"databaseName":"receiveflow_test"\}/);
  assert.match(result.stdout, /MARKER_FROZEN=true/);
}

// --- Missing or malformed TEST_DATABASE_URL ------------------------------------

test("refuses when TEST_DATABASE_URL is missing", () => {
  assertRefused({}, /TEST_DATABASE_URL is not set/);
});

test("refuses when TEST_DATABASE_URL is empty", () => {
  assertRefused({ TEST_DATABASE_URL: "" }, /TEST_DATABASE_URL is not set/);
});

test("refuses a malformed URL without echoing it", () => {
  assertRefused(
    { TEST_DATABASE_URL: "not a url receiveflow_test-secret-fragment" },
    /not a valid URL/,
    ["secret-fragment"],
  );
});

test("refuses a non-PostgreSQL URL", () => {
  assertRefused(
    { TEST_DATABASE_URL: urlFor("127.0.0.1:3306", "receiveflow_test", "mysql") },
    /must be a postgresql:\/\/ URL/,
  );
});

test("refuses a URL without a host (Unix socket form)", () => {
  assertRefused(
    { TEST_DATABASE_URL: "postgresql:///receiveflow_test" },
    /host is not allowed/,
  );
});

test("refuses a URL with no slash before the database name", () => {
  assertRefused(
    { TEST_DATABASE_URL: "postgresql:receiveflow_test" },
    /host is not allowed/,
  );
});

// --- Database name ----------------------------------------------------------------

test("refuses the development database receiveflow", () => {
  assertRefused({ TEST_DATABASE_URL: DEV_URL }, /targets the development database "receiveflow"/);
});

for (const [label, path] of [
  ["another database", "postgres"],
  ["a similar name", "receiveflow_test2"],
  ["a different case", "Receiveflow_Test"],
  ["a trailing slash", "receiveflow_test/"],
  ["an encoded name", "receiveflow%5Ftest"],
  ["a name with a path segment", "receiveflow_test/extra"],
  ["no database name", ""],
]) {
  test(`refuses ${label} without echoing it (/${path})`, () => {
    assertRefused(
      { TEST_DATABASE_URL: urlFor("127.0.0.1:5432", path) },
      /must target "receiveflow_test"$/m,
      path ? [path] : [],
    );
  });
}

for (const key of ["database", "dbname", "host", "hostaddr", "port", "DBNAME"]) {
  test(`refuses the "${key}" query parameter without echoing it`, () => {
    assertRefused(
      { TEST_DATABASE_URL: `${SAFE_URL}?${key}=elsewhere-value` },
      /must not use query parameters that change the host, port or database/,
      ["elsewhere-value", `"${key}"`],
    );
  });
}

// --- Host policy ------------------------------------------------------------------

for (const [label, host] of [
  ["a remote host", "db.example.com"],
  ["a look-alike host name", "localhost.example.com"],
  ["another loopback address", "127.0.0.2"],
  ["a shortened loopback address", "127.1"],
  ["a numeric host", "2130706433"],
  ["a trailing-dot host", "localhost."],
  ["the unspecified address", "0.0.0.0"],
]) {
  test(`refuses ${label} without echoing it (${host})`, () => {
    assertRefused(
      { TEST_DATABASE_URL: urlFor(`${host}:5432`) },
      /host is not allowed/,
      [host],
    );
  });
}

test("refuses a host hidden behind user info (localhost@remote)", () => {
  assertRefused(
    { TEST_DATABASE_URL: `postgresql://localhost@db.example.com:5432/receiveflow_test` },
    /host is not allowed/,
    ["db.example.com"],
  );
});

test("refuses a host the configured list does not include", () => {
  assertRefused(
    { TEST_DATABASE_URL: SAFE_URL, TEST_DATABASE_ALLOWED_HOSTS: "postgres" },
    /host is not allowed/,
  );
});

for (const [label, value] of [
  ["credentials", "guard_user:dummy-guard-secret@postgres"],
  ["a port", "postgres:5432"],
  ["a URL", "postgresql://postgres"],
  ["a wildcard", "*"],
  ["an empty entry", "localhost,,postgres"],
  ["an empty list", ""],
]) {
  test(`refuses TEST_DATABASE_ALLOWED_HOSTS containing ${label} without echoing it`, () => {
    assertRefused(
      { TEST_DATABASE_URL: SAFE_URL, TEST_DATABASE_ALLOWED_HOSTS: value },
      /TEST_DATABASE_ALLOWED_HOSTS must be a comma-separated list of plain host names/,
      value ? [value] : [],
    );
  });
}

// --- DATABASE_URL -----------------------------------------------------------------

test("refuses when DATABASE_URL points to a different database", () => {
  assertRefused(
    { TEST_DATABASE_URL: SAFE_URL, DATABASE_URL: DEV_URL },
    /DATABASE_URL is set to a different database/,
  );
});

test("refuses when DATABASE_URL is set but empty", () => {
  assertRefused(
    { TEST_DATABASE_URL: SAFE_URL, DATABASE_URL: "" },
    /DATABASE_URL is set to a different database/,
  );
});

// --- Accepted configurations ------------------------------------------------------

for (const [label, testUrl] of [
  ["127.0.0.1", SAFE_URL],
  ["localhost", urlFor("localhost:5432")],
  ["upper-case LOCALHOST", urlFor("LOCALHOST:5432")],
  ["IPv6 loopback [::1]", urlFor("[::1]:5432")],
  ["no port", urlFor("localhost")],
  ["the postgres:// scheme", urlFor("localhost:5432", "receiveflow_test", "postgres")],
  ["a harmless query parameter", `${SAFE_URL}?schema=public`],
]) {
  test(`passes with ${label}, sets DATABASE_URL and the marker`, () => {
    assertPassed({ TEST_DATABASE_URL: testUrl });
  });
}

test("passes when DATABASE_URL already equals TEST_DATABASE_URL", () => {
  assertPassed({ TEST_DATABASE_URL: SAFE_URL, DATABASE_URL: SAFE_URL });
});

test("passes with a configured host such as a CI service name", () => {
  assertPassed({
    TEST_DATABASE_URL: urlFor("postgres:5432"),
    TEST_DATABASE_ALLOWED_HOSTS: " postgres , localhost ",
  });
});
