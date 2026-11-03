// User management checks that need no database: input validation, and the
// manage-users command's refusals before it loads Prisma. DATABASE_URL is an
// unusable address on a closed local port, so nothing here can reach a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  assertValidPassword,
  createWarehouseUser,
  normalizeEmail,
  resetUserPassword,
  UserAdminError,
} from "../../src/auth/userAdmin.ts";
import { MAX_PASSWORD_LENGTH } from "../../src/auth/password.ts";

const API_ROOT = path.resolve(import.meta.dirname, "../..");
const UNUSABLE_DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/receiveflow_no_database";
const GOOD_PASSWORD = "Good-Password-1";

// Any database call fails the test.
const noDatabase = new Proxy({}, {
  get() {
    throw new Error("the database must not be used");
  },
}) as never;

function runCommand(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/scripts/manage-users.ts", ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    input: `${GOOD_PASSWORD}\n`,
    env: { PATH: process.env.PATH, DATABASE_URL: UNUSABLE_DATABASE_URL },
  });
}

test("emails are trimmed and lower-cased; invalid ones are refused", () => {
  assert.equal(normalizeEmail("  Worker@Example.TEST "), "worker@example.test");

  for (const email of ["", " ", "no-at-sign", "a@b", "a b@example.test", `${"a".repeat(250)}@example.test`]) {
    assert.throws(() => normalizeEmail(email), UserAdminError, JSON.stringify(email.slice(0, 20)));
  }
});

test("passwords must be 12 to 1024 characters", () => {
  assert.doesNotThrow(() => assertValidPassword("x".repeat(12)));
  assert.doesNotThrow(() => assertValidPassword("x".repeat(MAX_PASSWORD_LENGTH)));
  assert.throws(() => assertValidPassword("x".repeat(11)), /at least 12/);
  assert.throws(() => assertValidPassword("x".repeat(MAX_PASSWORD_LENGTH + 1)), /at most 1024/);
});

test("invalid input is refused before the database is used", async () => {
  await assert.rejects(createWarehouseUser(noDatabase, { email: "bad", password: GOOD_PASSWORD }), UserAdminError);
  await assert.rejects(createWarehouseUser(noDatabase, { email: "a@example.test", password: "short" }), UserAdminError);
  await assert.rejects(resetUserPassword(noDatabase, { email: "a@example.test", password: "short" }), UserAdminError);
});

test("the command refuses unknown commands and extra arguments, so a password can't be passed as one", () => {
  for (const args of [[], ["unknown"], ["create", GOOD_PASSWORD], ["deactivate", "a@example.test"]]) {
    const result = runCommand(args);

    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /\[manage-users\] STOP: usage:/, args.join(" "));
    assert.ok(!result.stdout.includes(GOOD_PASSWORD) && !result.stderr.includes(GOOD_PASSWORD));
  }
});

test("the command refuses piped input, so a password can't be piped in", () => {
  for (const command of ["create", "reset-password", "deactivate"]) {
    const result = runCommand([command]);

    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /STOP: run this script in an interactive terminal/, command);
    assert.ok(!result.stdout.includes(GOOD_PASSWORD) && !result.stderr.includes(GOOD_PASSWORD));
  }
});
