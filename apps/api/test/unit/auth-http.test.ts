// Login, sessions, CSRF, Origin, roles and CORS over real HTTP, using an
// in-memory store. No database. Each test starts its own app (and so its own
// login limiter) on a random 127.0.0.1 port.
import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { loadAuthConfig, type AuthConfig } from "../../src/auth/config.ts";
import { LOGIN_FAILED_MESSAGE } from "../../src/auth/index.ts";
import { hashPassword } from "../../src/auth/password.ts";
import { hashToken } from "../../src/auth/tokens.ts";
import type { AuthStore, AuthUser } from "../../src/auth/types.ts";
import { cookieFrom, createMemoryStore, request, startTestApp } from "./helpers.ts";

const FRONTEND = "http://localhost:5173";
const PASSWORD = "Warehouse-Password-1";
const ADMIN_PASSWORD = "Admin-Password-1";
const developmentConfig = loadAuthConfig({});

let warehouseHash = "";
let adminHash = "";

before(async () => {
  warehouseHash = await hashPassword(PASSWORD);
  adminHash = await hashPassword(ADMIN_PASSWORD);
});

function testUsers(): AuthUser[] {
  return [
    { id: 1, email: "warehouse@example.test", role: "WAREHOUSE", active: true, passwordHash: warehouseHash },
    { id: 2, email: "admin@example.test", role: "ADMIN", active: true, passwordHash: adminHash },
    { id: 3, email: "inactive@example.test", role: "WAREHOUSE", active: false, passwordHash: warehouseHash },
  ];
}

async function setup(
  t: TestContext,
  options: { config?: AuthConfig; wrapStore?: (store: AuthStore) => AuthStore } = {},
) {
  let time = Date.UTC(2026, 9, 28, 8, 0, 0);
  const memory = createMemoryStore(testUsers());
  const app = await startTestApp({
    store: options.wrapStore ? options.wrapStore(memory.store) : memory.store,
    config: options.config ?? developmentConfig,
    now: () => time,
  });
  t.after(app.close);

  async function login(email = "warehouse@example.test", password = PASSWORD) {
    const response = await request(app.port, "/auth/login", { method: "POST", body: { email, password } });
    assert.equal(response.status, 200, response.text);
    return { response, cookie: cookieFrom(response)!, csrfToken: response.body.csrfToken as string };
  }

  return { ...memory, port: app.port, login, advance: (ms: number) => (time += ms) };
}

test("login sets a session cookie and returns the CSRF token, never the password hash", async (t) => {
  const { port, sessions, login } = await setup(t);
  const { response, cookie, csrfToken } = await login();

  const setCookie = response.headers["set-cookie"]?.[0] ?? "";
  assert.match(setCookie, /^rf_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax$/);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.body.user, { email: "warehouse@example.test", role: "WAREHOUSE" });
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!response.text.includes("passwordHash") && !response.text.includes("$argon2"));

  // Only the SHA-256 of the cookie token is stored, never the token itself.
  const token = cookie.split("=")[1];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tokenHash, hashToken(token));
  assert.notEqual(sessions[0].tokenHash, token);
  assert.equal(sessions[0].csrfToken, csrfToken);
  assert.equal(sessions[0].userId, 1);

  const me = await request(port, "/auth/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { email: "warehouse@example.test", role: "WAREHOUSE" });
  assert.equal(me.body.csrfToken, csrfToken);
});

test("in production the cookie is Secure and uses the __Host- prefix", async (t) => {
  const config = loadAuthConfig({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.test" });
  const { port } = await setup(t, { config });

  const response = await request(port, "/auth/login", {
    method: "POST",
    body: { email: "warehouse@example.test", password: PASSWORD },
  });

  assert.equal(response.status, 200, response.text);
  assert.match(
    response.headers["set-cookie"]?.[0] ?? "",
    /^__Host-rf_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure$/,
  );
});

test("wrong password, unknown email and inactive user all get the same 401 and no session", async (t) => {
  const { port, sessions } = await setup(t);

  for (const body of [
    { email: "warehouse@example.test", password: "wrong" },
    { email: "nobody@example.test", password: PASSWORD },
    { email: "inactive@example.test", password: PASSWORD },
  ]) {
    const response = await request(port, "/auth/login", { method: "POST", body });

    assert.equal(response.status, 401, body.email);
    assert.deepEqual(response.body, { error: LOGIN_FAILED_MESSAGE });
    assert.equal(response.headers["set-cookie"], undefined);
  }

  assert.equal(sessions.length, 0);
});

test("the email is trimmed and matched case-insensitively", async (t) => {
  const { login } = await setup(t);
  const { response } = await login("  Warehouse@Example.TEST ");

  assert.equal(response.body.user.email, "warehouse@example.test");
});

test("login refuses non-JSON with 415 and incomplete or oversized input with 400", async (t) => {
  const { port } = await setup(t);

  const plain = await request(port, "/auth/login", {
    method: "POST",
    rawBody: "email=warehouse@example.test&password=x",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(plain.status, 415);

  for (const body of [
    {},
    { email: "warehouse@example.test" },
    { email: 1, password: PASSWORD },
    { email: " ", password: PASSWORD },
    { email: "warehouse@example.test", password: "" },
    { email: "warehouse@example.test", password: "x".repeat(1025) },
    { email: `${"a".repeat(250)}@example.test`, password: PASSWORD },
  ]) {
    const response = await request(port, "/auth/login", { method: "POST", body });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.deepEqual(response.body, { error: "Email and password are required" });
  }
});

test("login from a foreign Origin is refused; the frontend origin is accepted", async (t) => {
  const { port } = await setup(t);
  const body = { email: "warehouse@example.test", password: PASSWORD };

  for (const origin of ["https://evil.example", "null", "http://127.0.0.1:5173"]) {
    const response = await request(port, "/auth/login", { method: "POST", body, headers: { Origin: origin } });
    assert.equal(response.status, 403, origin);
    assert.deepEqual(response.body, { error: "Origin not allowed" });
  }

  const allowed = await request(port, "/auth/login", { method: "POST", body, headers: { Origin: FRONTEND } });
  assert.equal(allowed.status, 200);
});

test("after 10 failed logins the 11th attempt gets 429, even with the right password, until the window ends", async (t) => {
  const { port, advance } = await setup(t);
  const attempt = (password: string) =>
    request(port, "/auth/login", { method: "POST", body: { email: "warehouse@example.test", password } });

  for (let failure = 1; failure <= 10; failure += 1) {
    assert.equal((await attempt(`wrong-${failure}`)).status, 401, `failure ${failure}`);
  }

  const blocked = await attempt(PASSWORD);
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: "Too many failed login attempts. Try again later." });
  assert.equal(blocked.headers["retry-after"], "900");

  advance(15 * 60 * 1000);
  assert.equal((await attempt(PASSWORD)).status, 200);
});

test("protected routes need a valid session; bad or unknown cookies get 401 and are cleared", async (t) => {
  const { port } = await setup(t);

  for (const [method, path] of [
    ["GET", "/data"],
    ["POST", "/data"],
    ["POST", "/admin"],
    ["GET", "/auth/me"],
    ["POST", "/auth/logout"],
  ]) {
    const response = await request(port, path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.deepEqual(response.body, { error: "Authentication required" });
  }

  for (const cookie of ["rf_session=garbage", `rf_session=${"A".repeat(43)}`]) {
    const response = await request(port, "/data", { headers: { Cookie: cookie } });
    assert.equal(response.status, 401, cookie);
    assert.match(response.headers["set-cookie"]?.[0] ?? "", /^rf_session=; Path=\/; Max-Age=0;/);
  }

  const health = await request(port, "/health");
  assert.equal(health.status, 200, "public routes stay public");
});

test("an expired session is refused and deleted", async (t) => {
  const { port, sessions, login, advance } = await setup(t);
  const { cookie } = await login();

  advance(12 * 60 * 60 * 1000 - 1000);
  assert.equal((await request(port, "/data", { headers: { Cookie: cookie } })).status, 200);

  advance(1000);
  assert.equal((await request(port, "/data", { headers: { Cookie: cookie } })).status, 401);
  assert.equal(sessions.length, 0);
});

test("deactivating a user ends their access immediately", async (t) => {
  const { port, users, login } = await setup(t);
  const { cookie } = await login();

  assert.equal((await request(port, "/data", { headers: { Cookie: cookie } })).status, 200);
  users[0].active = false;
  assert.equal((await request(port, "/data", { headers: { Cookie: cookie } })).status, 401);
});

test("state-changing requests need the session's own CSRF token; reads don't", async (t) => {
  const { port, login } = await setup(t);
  const first = await login();
  const second = await login();

  const post = (headers: Record<string, string>) => request(port, "/data", { method: "POST", body: {}, headers });

  assert.equal((await post({ Cookie: first.cookie })).status, 403, "no token");
  assert.equal((await post({ Cookie: first.cookie, "X-CSRF-Token": "wrong" })).status, 403, "wrong token");
  assert.equal(
    (await post({ Cookie: first.cookie, "X-CSRF-Token": second.csrfToken })).status,
    403,
    "another session's token",
  );

  const missing = await post({ Cookie: first.cookie });
  assert.deepEqual(missing.body, { error: "Invalid or missing CSRF token" });

  assert.equal((await post({ Cookie: first.cookie, "X-CSRF-Token": first.csrfToken })).status, 201);
  assert.equal((await request(port, "/data", { headers: { Cookie: first.cookie } })).status, 200);
});

test("a foreign Origin is refused even with a valid session and CSRF token", async (t) => {
  const { port, login } = await setup(t);
  const { cookie, csrfToken } = await login();
  const post = (origin: string) =>
    request(port, "/data", {
      method: "POST",
      body: {},
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, Origin: origin },
    });

  for (const origin of ["https://evil.example", "null", "http://localhost:3000"]) {
    const response = await post(origin);
    assert.equal(response.status, 403, origin);
    assert.deepEqual(response.body, { error: "Origin not allowed" });
  }

  assert.equal((await post(FRONTEND)).status, 201);
});

test("WAREHOUSE is refused on ADMIN routes; ADMIN is allowed", async (t) => {
  const { port, login } = await setup(t);
  const warehouse = await login();
  const admin = await login("admin@example.test", ADMIN_PASSWORD);
  const postAdmin = (session: { cookie: string; csrfToken: string }) =>
    request(port, "/admin", {
      method: "POST",
      body: {},
      headers: { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken },
    });

  const refused = await postAdmin(warehouse);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, { error: "You do not have permission to do this" });
  assert.equal((await postAdmin(admin)).status, 200);
});

test("logout needs the CSRF token, deletes the session and clears the cookie", async (t) => {
  const { port, sessions, login } = await setup(t);
  const { cookie, csrfToken } = await login();

  const withoutToken = await request(port, "/auth/logout", { method: "POST", headers: { Cookie: cookie } });
  assert.equal(withoutToken.status, 403);
  assert.equal(sessions.length, 1, "a refused logout keeps the session");

  const logout = await request(port, "/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers["set-cookie"]?.[0] ?? "", /^rf_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/);
  assert.equal(sessions.length, 0);

  assert.equal((await request(port, "/auth/me", { headers: { Cookie: cookie } })).status, 401);
});

test("each login gets a new session token", async (t) => {
  const { sessions, login } = await setup(t);
  const first = await login();
  const second = await login();

  assert.notEqual(first.cookie, second.cookie);
  assert.notEqual(first.csrfToken, second.csrfToken);
  assert.equal(sessions.length, 2);
});

test("CORS approves only the frontend origin, with credentials and the CSRF header", async (t) => {
  const { port } = await setup(t);
  const preflight = (origin: string) =>
    request(port, "/data", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
      },
    });

  const allowed = await preflight(FRONTEND);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], FRONTEND);
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.match(String(allowed.headers["access-control-allow-headers"]), /X-CSRF-Token/);

  const foreign = await preflight("https://evil.example");
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);
});

function attemptLogin(port: number, email: string, password: string, headers: Record<string, string> = {}) {
  return request(port, "/auth/login", { method: "POST", body: { email, password }, headers });
}

test("the per-IP limit counts failures across different emails", async (t) => {
  const { port } = await setup(t);

  for (let n = 1; n <= 10; n += 1) {
    assert.equal((await attemptLogin(port, `unknown-${n}@example.test`, "x")).status, 401, `failure ${n}`);
  }

  const blocked = await attemptLogin(port, "warehouse@example.test", PASSWORD);
  assert.equal(blocked.status, 429, "an email with no failures of its own is still blocked by its IP");
});

test("a successful login resets only that email's counter, not the IP's", async (t) => {
  const { port } = await setup(t);

  for (let n = 1; n <= 9; n += 1) {
    assert.equal((await attemptLogin(port, "warehouse@example.test", `wrong-${n}`)).status, 401);
  }

  // Resets the email counter (9 -> 0) but leaves the IP counter at 9.
  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 200);

  // The IP's 10th failure, with another email.
  assert.equal((await attemptLogin(port, "nobody@example.test", "x")).status, 401);

  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 429);
});

test("concurrent wrong passwords can't get more than 10 password checks", async (t) => {
  const { port } = await setup(t);

  const responses = await Promise.all(
    Array.from({ length: 60 }, (_, n) => attemptLogin(port, "warehouse@example.test", `wrong-${n}`)),
  );
  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 401).length, 10);
  assert.equal(statuses.filter((status) => status === 429).length, 50);

  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 429);
});

test("concurrent wrong passwords across emails are limited by the IP as well", async (t) => {
  const { port } = await setup(t);

  const responses = await Promise.all(
    Array.from({ length: 30 }, (_, n) => attemptLogin(port, `unknown-${n}@example.test`, "x")),
  );

  assert.equal(responses.filter((response) => response.status === 401).length, 10);
  assert.equal(responses.filter((response) => response.status === 429).length, 20);
});

test("successful logins never count towards the limit", async (t) => {
  const { port } = await setup(t);

  for (let n = 1; n <= 15; n += 1) {
    assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 200, `login ${n}`);
  }

  // All 10 failures are still available to this address and email.
  for (let n = 1; n <= 10; n += 1) {
    assert.equal((await attemptLogin(port, "warehouse@example.test", `wrong-${n}`)).status, 401, `failure ${n}`);
  }
  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 429);
});

test("a successful login clears the email's failures for a login from another address", async (t) => {
  const { port } = await setup(t, { config: loadAuthConfig({ TRUST_PROXY: "1" }) });
  const from = (address: string) => ({ "X-Forwarded-For": address });

  for (let n = 1; n <= 9; n += 1) {
    assert.equal(
      (await attemptLogin(port, "warehouse@example.test", `wrong-${n}`, from("203.0.113.1"))).status,
      401,
    );
  }

  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD, from("203.0.113.2"))).status, 200);

  // The email's count is back to 0, so 10 more failures are possible from a new address.
  for (let n = 1; n <= 10; n += 1) {
    assert.equal(
      (await attemptLogin(port, "warehouse@example.test", `wrong-${n}`, from("203.0.113.3"))).status,
      401,
      `failure ${n}`,
    );
  }
  assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD, from("203.0.113.4"))).status, 429);
});

test("with TRUST_PROXY=0, X-Forwarded-For cannot change the client address", async (t) => {
  const { port } = await setup(t);

  for (let n = 1; n <= 10; n += 1) {
    const response = await attemptLogin(port, `unknown-${n}@example.test`, "x", {
      "X-Forwarded-For": `203.0.113.${n}`,
    });
    assert.equal(response.status, 401);
  }

  const blocked = await attemptLogin(port, "warehouse@example.test", PASSWORD, {
    "X-Forwarded-For": "198.51.100.7",
  });
  assert.equal(blocked.status, 429, "all ten failures were counted for the real address");
});

test("with TRUST_PROXY=1, the client address from the proxy's X-Forwarded-For is used", async (t) => {
  const { port } = await setup(t, { config: loadAuthConfig({ TRUST_PROXY: "1" }) });

  for (let n = 1; n <= 10; n += 1) {
    const response = await attemptLogin(port, `unknown-${n}@example.test`, "x", {
      "X-Forwarded-For": `203.0.113.${n}`,
    });
    assert.equal(response.status, 401);
  }

  const allowed = await attemptLogin(port, "warehouse@example.test", PASSWORD, {
    "X-Forwarded-For": "198.51.100.7",
  });
  assert.equal(allowed.status, 200, "each forwarded address has its own counter");
});

function failing(store: AuthStore, method: keyof AuthStore): AuthStore {
  return {
    ...store,
    [method]: async () => {
      throw new Error("store unavailable");
    },
  };
}

test("if the session lookup fails, requests are refused with 500, never let through", async (t) => {
  t.mock.method(console, "error", () => {});
  const { port, login } = await setup(t, { wrapStore: (store) => failing(store, "findSession") });
  const { cookie, csrfToken } = await login();

  for (const [method, path] of [
    ["GET", "/data"],
    ["POST", "/data"],
    ["DELETE", "/data"],
    ["POST", "/admin"],
    ["GET", "/auth/me"],
    ["POST", "/auth/logout"],
  ]) {
    const response = await request(port, path, {
      method,
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    });
    assert.equal(response.status, 500, `${method} ${path}`);
    assert.deepEqual(response.body, { error: "Authentication check failed" });
  }
});

test("if a store call fails during login, login fails with 500 and sets no cookie", async (t) => {
  t.mock.method(console, "error", () => {});

  for (const method of ["findUserByEmail", "deleteExpiredSessions", "createSession"] as const) {
    const { port } = await setup(t, { wrapStore: (store) => failing(store, method) });
    const response = await attemptLogin(port, "warehouse@example.test", PASSWORD);

    assert.equal(response.status, 500, method);
    assert.deepEqual(response.body, { error: "Login failed" });
    assert.equal(response.headers["set-cookie"], undefined, method);
  }
});

test("store failures during login don't count towards the limit", async (t) => {
  t.mock.method(console, "error", () => {});

  for (const method of ["findUserByEmail", "deleteExpiredSessions", "createSession"] as const) {
    const { port } = await setup(t, { wrapStore: (store) => failing(store, method) });

    for (let n = 1; n <= 15; n += 1) {
      assert.equal((await attemptLogin(port, "warehouse@example.test", PASSWORD)).status, 500, `${method} ${n}`);
    }
  }
});

test("PUT and DELETE need a session, the CSRF token and an allowed Origin, like POST", async (t) => {
  const { port, login } = await setup(t);
  const { cookie, csrfToken } = await login();

  for (const method of ["PUT", "DELETE"]) {
    const send = (headers: Record<string, string>) => request(port, "/data", { method, body: {}, headers });

    assert.equal((await send({})).status, 401, `${method} without a session`);
    assert.equal((await send({ Cookie: cookie })).status, 403, `${method} without a token`);
    assert.equal((await send({ Cookie: cookie, "X-CSRF-Token": "wrong" })).status, 403, `${method} wrong token`);
    assert.equal(
      (await send({ Cookie: cookie, "X-CSRF-Token": csrfToken, Origin: "https://evil.example" })).status,
      403,
      `${method} foreign Origin`,
    );
    assert.equal((await send({ Cookie: cookie, "X-CSRF-Token": csrfToken })).status, 200, `${method} with token`);
  }
});

test("authenticated replies are marked Cache-Control: private, no-store", async (t) => {
  const { port, login } = await setup(t);
  const { cookie, csrfToken } = await login();

  for (const [method, path] of [
    ["GET", "/data"],
    ["POST", "/data"],
    ["GET", "/auth/me"],
  ]) {
    const response = await request(port, path, {
      method,
      body: method === "GET" ? undefined : {},
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    });
    assert.equal(response.headers["cache-control"], "private, no-store", `${method} ${path}`);
  }
});

test("in production only the https frontend origin gets CORS approval and passes the Origin check", async (t) => {
  const config = loadAuthConfig({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.test" });
  const { port } = await setup(t, { config });
  const preflight = (origin: string) =>
    request(port, "/data", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });

  assert.equal((await preflight("https://app.example.test")).headers["access-control-allow-origin"], "https://app.example.test");
  assert.equal((await preflight("http://app.example.test")).headers["access-control-allow-origin"], undefined);

  const body = { email: "warehouse@example.test", password: PASSWORD };
  const plainHttp = await request(port, "/auth/login", { method: "POST", body, headers: { Origin: "http://app.example.test" } });
  assert.equal(plainHttp.status, 403);

  const https = await request(port, "/auth/login", { method: "POST", body, headers: { Origin: "https://app.example.test" } });
  assert.equal(https.status, 200);
});
