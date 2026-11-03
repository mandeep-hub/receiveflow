// Tokens, hashing and the session cookie. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadAuthConfig } from "../../src/auth/config.ts";
import {
  clearedSessionCookie,
  generateToken,
  hashToken,
  parseCookies,
  sessionCookie,
  TOKEN_PATTERN,
  tokensEqual,
} from "../../src/auth/tokens.ts";

test("tokens are 32 random bytes in base64url and never repeat", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));

  assert.equal(tokens.size, 200);
  for (const token of tokens) {
    assert.match(token, TOKEN_PATTERN);
    assert.equal(Buffer.from(token, "base64url").length, 32);
  }
});

test("hashToken is the SHA-256 hex digest and differs from the token", () => {
  const token = generateToken();
  const hash = hashToken(token);

  assert.equal(hash, createHash("sha256").update(token).digest("hex"));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
});

test("tokensEqual compares exactly, including different lengths", () => {
  const token = generateToken();

  assert.equal(tokensEqual(token, token), true);
  assert.equal(tokensEqual(token, generateToken()), false);
  assert.equal(tokensEqual(token, token.slice(1)), false);
  assert.equal(tokensEqual("", token), false);
});

test("parseCookies reads name=value pairs and ignores malformed parts", () => {
  const cookies = parseCookies("a=1; rf_session=abc; =bad; noequals; b = 2 ; a=second");

  assert.equal(cookies.get("a"), "1", "the first value wins");
  assert.equal(cookies.get("rf_session"), "abc");
  assert.equal(cookies.get("b"), "2");
  assert.equal(cookies.size, 3);
  assert.equal(parseCookies(undefined).size, 0);
});

test("the session cookie is HttpOnly, SameSite=Lax, Path=/, 12 hours; Secure in production", () => {
  const token = generateToken();
  const development = loadAuthConfig({});
  const production = loadAuthConfig({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.test" });

  assert.equal(
    sessionCookie(development, token),
    `rf_session=${token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`,
  );
  assert.equal(
    sessionCookie(production, token),
    `__Host-rf_session=${token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure`,
  );
  assert.equal(clearedSessionCookie(development), "rf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  assert.equal(
    clearedSessionCookie(production),
    "__Host-rf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
  );
});
