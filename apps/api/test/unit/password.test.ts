// Argon2id password hashing. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARGON2_OPTIONS,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "../../src/auth/password.ts";

test("hashes use Argon2id with the configured settings and a random salt", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");

  // PHC format: $argon2id$v=19$<m=…,p=…,t=…>$<salt>$<hash> (parameter order varies).
  const [, algorithm, version, parameters] = first.split("$");
  const settings = Object.fromEntries(parameters.split(",").map((pair) => pair.split("=")));

  assert.equal(algorithm, "argon2id");
  assert.equal(version, "v=19");
  assert.deepEqual(settings, {
    m: String(ARGON2_OPTIONS.memoryCost),
    t: String(ARGON2_OPTIONS.timeCost),
    p: String(ARGON2_OPTIONS.parallelism),
  });
  assert.ok(!first.includes("correct horse battery staple"), "the password must not appear in the hash");
  assert.notEqual(first, second, "each hash has its own salt");
});

test("verification accepts the right password and rejects others", async () => {
  const hash = await hashPassword("s3cret-Password!");

  assert.equal(await verifyPassword(hash, "s3cret-Password!"), true);
  assert.equal(await verifyPassword(hash, "s3cret-password!"), false);
  assert.equal(await verifyPassword(hash, ""), false);
});

test("a malformed hash is treated as a mismatch, not an error", async () => {
  assert.equal(await verifyPassword("not-a-hash", "anything"), false);
  assert.equal(await verifyPassword("", "anything"), false);
});

test("the dummy hash is a real Argon2id hash that matches nothing guessable", async () => {
  const dummy = await getDummyPasswordHash();

  assert.match(dummy, /^\$argon2id\$/);
  assert.equal(await getDummyPasswordHash(), dummy, "created once and reused");
  assert.equal(await verifyPassword(dummy, ""), false);
  assert.equal(await verifyPassword(dummy, "password"), false);
});
