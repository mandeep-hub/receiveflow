// Authentication settings. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEVELOPMENT_FRONTEND_ORIGIN,
  loadAuthConfig,
  SESSION_TTL_SECONDS,
} from "../../src/auth/config.ts";

test("development defaults: local frontend origin, plain cookie name, no Secure", () => {
  const config = loadAuthConfig({});

  assert.equal(config.production, false);
  assert.equal(config.frontendOrigin, DEVELOPMENT_FRONTEND_ORIGIN);
  assert.equal(config.cookieName, "rf_session");
  assert.equal(config.secureCookies, false);
  assert.equal(config.sessionTtlSeconds, SESSION_TTL_SECONDS);
  assert.equal(config.sessionTtlSeconds, 12 * 60 * 60);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.loginMaxFailures, 10);
  assert.equal(config.loginWindowMs, 15 * 60 * 1000);
});

test("production needs an https FRONTEND_ORIGIN and uses a Secure __Host- cookie", () => {
  assert.throws(() => loadAuthConfig({ NODE_ENV: "production" }), /FRONTEND_ORIGIN must be set/);
  assert.throws(
    () => loadAuthConfig({ NODE_ENV: "production", FRONTEND_ORIGIN: "http://app.example.test" }),
    /https:\/\/ origin/,
  );

  const config = loadAuthConfig({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.test/" });

  assert.equal(config.production, true);
  assert.equal(config.frontendOrigin, "https://app.example.test", "normalized to the bare origin");
  assert.equal(config.cookieName, "__Host-rf_session");
  assert.equal(config.secureCookies, true);
});

test("an https FRONTEND_ORIGIN without NODE_ENV=production is refused (no silent cookie downgrade)", () => {
  for (const env of [
    { FRONTEND_ORIGIN: "https://app.example.test" },
    { NODE_ENV: "development", FRONTEND_ORIGIN: "https://app.example.test" },
    { NODE_ENV: "test", FRONTEND_ORIGIN: "https://app.example.test:8443/" },
  ]) {
    assert.throws(() => loadAuthConfig(env), /NODE_ENV=production/, JSON.stringify(env));
  }

  // Plain http development origins are still fine.
  assert.equal(loadAuthConfig({ FRONTEND_ORIGIN: "http://localhost:5173" }).secureCookies, false);
});

test("FRONTEND_ORIGIN must be a bare origin", () => {
  for (const value of [
    "not a url",
    "ftp://app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?x=1",
    "https://app.example.test#top",
    "https://user:secret@app.example.test",
  ]) {
    assert.throws(() => loadAuthConfig({ FRONTEND_ORIGIN: value }), /FRONTEND_ORIGIN/, value);
  }

  assert.equal(
    loadAuthConfig({ FRONTEND_ORIGIN: "http://127.0.0.1:5173" }).frontendOrigin,
    "http://127.0.0.1:5173",
  );
});

test("TRUST_PROXY accepts only a small number of proxy hops", () => {
  assert.equal(loadAuthConfig({ TRUST_PROXY: "1" }).trustProxyHops, 1);
  assert.equal(loadAuthConfig({ TRUST_PROXY: " 2 " }).trustProxyHops, 2);
  assert.equal(loadAuthConfig({ TRUST_PROXY: "" }).trustProxyHops, 0);

  for (const value of ["true", "-1", "1.5", "100", "loopback"]) {
    assert.throws(() => loadAuthConfig({ TRUST_PROXY: value }), /TRUST_PROXY/, value);
  }
});
