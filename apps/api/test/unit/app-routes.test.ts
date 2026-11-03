// The real src/app.ts, without a database: route protection for logged-out
// requests, the public routes, and CORS. No request here carries a session
// cookie, so requireAuth answers before any database lookup.
//
// DATABASE_URL is set to an unusable address on a closed local port before the
// app is imported, so even an accidental query could not reach a database.
// The other auth settings are set explicitly, so values from a local .env
// (loaded by src/lib/prisma.ts, which never overrides set variables) can't
// change the results.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { request } from "./helpers.ts";

const FRONTEND = "http://localhost:5173";

process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/receiveflow_no_database";
process.env.NODE_ENV = "test";
process.env.FRONTEND_ORIGIN = FRONTEND;
process.env.TRUST_PROXY = "0";

let app: import("express").Express;
let server: Server;
let port = 0;

before(async () => {
  ({ default: app } = await import("../../src/app.ts"));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve).once("error", reject);
  });
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const PUBLIC_ROUTES = ["GET /", "GET /health"];

const ADMIN_ROUTES = [
  "POST /suppliers",
  "PUT /suppliers/:id",
  "DELETE /suppliers/:id",
  "POST /products",
  "PUT /products/:id",
  "DELETE /products/:id",
  "POST /purchase-orders",
  "POST /purchase-orders/:id/recalculate-status",
  "GET /users",
  "POST /users",
  "POST /users/:id/reset-password",
  "POST /users/:id/deactivate",
  "POST /users/:id/reactivate",
];

const SIGNED_IN_ROUTES = [
  "GET /suppliers",
  "GET /suppliers/:id",
  "GET /products",
  "GET /products/:id",
  "GET /purchase-orders",
  "GET /purchase-orders/:id",
  "POST /receivings",
  "GET /receivings",
  "GET /receivings/report",
  "GET /receivings/:id",
];

// Fails when a route is added or removed without being classified here.
test("every route registered in app.ts is classified as public, signed-in or admin", () => {
  const stack: any[] = (app as any).router.stack;
  const registered = stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method] && method !== "_all")
        .map((method) => `${method.toUpperCase()} ${layer.route.path}`),
    )
    .sort();

  assert.deepEqual(registered, [...PUBLIC_ROUTES, ...ADMIN_ROUTES, ...SIGNED_IN_ROUTES].sort());
});

test("the public routes answer without a session", async () => {
  const root = await request(port, "/");
  assert.equal(root.status, 200);
  assert.deepEqual(root.body, { name: "ReceiveFlow API", status: "running" });

  const health = await request(port, "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: "ok" });
  assert.equal(health.headers["x-powered-by"], undefined);
});

test("every other route, the auth routes and unknown paths return 401 without a session", async () => {
  const concrete = (route: string) => {
    const [method, path] = route.split(" ");
    return [method, path.replace(":id", "1") + (path === "/receivings/report" ? "?date=2026-01-01" : "")];
  };

  for (const [method, path] of [
    ...[...ADMIN_ROUTES, ...SIGNED_IN_ROUTES].map(concrete),
    ["GET", "/auth/me"],
    ["POST", "/auth/logout"],
    ["GET", "/no-such-route"],
    ["HEAD", "/suppliers"],
  ]) {
    const response = await request(port, path, {
      method,
      body: method === "GET" || method === "HEAD" ? undefined : {},
    });
    assert.equal(response.status, 401, `${method} ${path}`);

    if (method !== "HEAD") {
      assert.deepEqual(response.body, { error: "Authentication required" }, `${method} ${path}`);
    }
  }
});

test("login checks that need no database: foreign Origin 403, non-JSON 415, bad input 400", async () => {
  const body = { email: "someone@example.test", password: "x" };

  const foreign = await request(port, "/auth/login", { method: "POST", body, headers: { Origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);

  const form = await request(port, "/auth/login", {
    method: "POST",
    rawBody: "email=a&password=b",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(form.status, 415);

  const incomplete = await request(port, "/auth/login", { method: "POST", body: { email: "someone@example.test" } });
  assert.equal(incomplete.status, 400);
});

test("CORS: only the frontend origin is approved, with credentials and the CSRF header", async () => {
  const preflight = (origin: string, path: string) =>
    request(port, path, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
      },
    });

  for (const path of ["/receivings", "/suppliers", "/auth/login"]) {
    const allowed = await preflight(FRONTEND, path);
    assert.equal(allowed.status, 204, path);
    assert.equal(allowed.headers["access-control-allow-origin"], FRONTEND, path);
    assert.equal(allowed.headers["access-control-allow-credentials"], "true", path);
    assert.match(String(allowed.headers["access-control-allow-headers"]), /X-CSRF-Token/, path);

    const foreign = await preflight("https://evil.example", path);
    assert.equal(foreign.headers["access-control-allow-origin"], undefined, path);
    assert.equal(foreign.headers["access-control-allow-credentials"], undefined, path);
  }

  const simple = await request(port, "/health", { headers: { Origin: FRONTEND } });
  assert.equal(simple.headers["access-control-allow-origin"], FRONTEND);

  const simpleForeign = await request(port, "/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(simpleForeign.headers["access-control-allow-origin"], undefined);
});
