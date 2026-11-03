// Helpers for the database-free auth tests: an in-memory AuthStore, a test app
// wired like src/app.ts, and a plain HTTP client that sets headers exactly as
// given (including Origin, as a browser would).
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import { createAuth } from "../../src/auth/index.ts";
import type { AuthConfig } from "../../src/auth/config.ts";
import type { LoginRateLimiter } from "../../src/auth/rateLimit.ts";
import type { AuthStore, AuthUser, SessionRecord } from "../../src/auth/types.ts";

export function createMemoryStore(users: AuthUser[]) {
  const sessions: SessionRecord[] = [];
  let nextSessionId = 1;

  const store: AuthStore = {
    async findUserByEmail(email) {
      const user = users.find((candidate) => candidate.email === email);
      return user ? { ...user } : null;
    },
    async createSession(data) {
      sessions.push({ id: nextSessionId++, ...data });
    },
    async findSession(tokenHash) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      const user = session && users.find((candidate) => candidate.id === session.userId);
      return session && user ? { session: { ...session }, user: { ...user } } : null;
    },
    async deleteSession(id) {
      const index = sessions.findIndex((candidate) => candidate.id === id);
      if (index !== -1) sessions.splice(index, 1);
    },
    async deleteExpiredSessions(now) {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].expiresAt.getTime() <= now.getTime()) sessions.splice(index, 1);
      }
    },
  };

  return { store, users, sessions };
}

// Same order as src/app.ts: trust proxy, CORS, JSON, auth routes,
// requireAuth, requireCsrf, then the protected routes.
export async function startTestApp(options: {
  store: AuthStore;
  config: AuthConfig;
  now?: () => number;
  limiter?: LoginRateLimiter;
}) {
  const auth = createAuth(options);
  const app = express();

  if (options.config.trustProxyHops > 0) {
    app.set("trust proxy", options.config.trustProxyHops);
  }

  app.use(cors(auth.corsOptions));
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(auth.router);
  app.use(auth.requireAuth);
  app.use(auth.requireCsrf);
  app.get("/data", (_req, res) => res.json({ ok: true }));
  app.post("/data", (_req, res) => res.status(201).json({ ok: true }));
  app.put("/data", (_req, res) => res.json({ ok: true }));
  app.delete("/data", (_req, res) => res.json({ ok: true }));
  app.post("/admin", auth.requireRole("ADMIN"), (_req, res) => res.json({ ok: true }));

  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve).once("error", reject);
  });

  const port = (server.address() as AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  return { port, close };
}

export type TestResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  text: string;
};

export function request(
  port: number,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
  } = {},
): Promise<TestResponse> {
  const { method = "GET", headers = {}, body, rawBody } = options;
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const finalHeaders: Record<string, string> = { ...headers };

  if (payload !== undefined) {
    finalHeaders["Content-Type"] ??= "application/json";
    finalHeaders["Content-Length"] = String(Buffer.byteLength(payload));
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: finalHeaders, agent: false },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed, text });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

// The "name=value" part of the response's Set-Cookie header.
export function cookieFrom(response: TestResponse): string | undefined {
  const header = response.headers["set-cookie"]?.[0];
  return header?.split(";")[0];
}
