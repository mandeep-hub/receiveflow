// Login, logout, current user, and the middleware that protects the API.
//
// - requireAuth: a valid, unexpired session for an active user, or 401.
// - requireCsrf: for POST/PUT/PATCH/DELETE, the Origin (when sent) must be the
//   frontend origin and X-CSRF-Token must equal the session's token, or 403.
// - requireRole(...roles): the logged-in user's role must be listed, or 403.
//
// Built from an AuthStore, so tests can use an in-memory store.
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { CorsOptions } from "cors";
import type { AuthConfig } from "./config.js";
import {
  getDummyPasswordHash,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
} from "./password.js";
import { createLoginRateLimiter, type LoginRateLimiter } from "./rateLimit.js";
import {
  clearedSessionCookie,
  generateToken,
  hashToken,
  parseCookies,
  sessionCookie,
  TOKEN_PATTERN,
  tokensEqual,
} from "./tokens.js";
import type { AuthContext, AuthStore, Role } from "./types.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_EMAIL_LENGTH = 254;

export const LOGIN_FAILED_MESSAGE = "Invalid email or password";

// Only the frontend origin gets CORS approval, with cookies allowed.
export function corsOptions(config: AuthConfig): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, origin === config.frontendOrigin),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    maxAge: 600,
  };
}

export function createAuth(options: {
  store: AuthStore;
  config: AuthConfig;
  limiter?: LoginRateLimiter;
  now?: () => number;
}) {
  const { store, config, now = Date.now } = options;
  const limiter =
    options.limiter ??
    createLoginRateLimiter({
      maxFailures: config.loginMaxFailures,
      windowMs: config.loginWindowMs,
      now,
    });

  // A missing Origin is allowed (non-browser clients can't carry a victim's
  // cookie); a different one, including "null", is not.
  function originAllowed(req: Request) {
    const origin = req.get("origin");
    return origin === undefined || origin === config.frontendOrigin;
  }

  // Authenticated replies (and the auth endpoints) must never be cached by the
  // browser or a shared cache.
  function noStore(res: Response) {
    res.setHeader("Cache-Control", "private, no-store");
  }

  function unauthorized(res: Response, clearCookie: boolean) {
    if (clearCookie) {
      res.setHeader("Set-Cookie", clearedSessionCookie(config));
    }

    return res.status(401).json({ error: "Authentication required" });
  }

  const requireAuth: RequestHandler = async (req, res, next) => {
    const token = parseCookies(req.headers.cookie).get(config.cookieName);

    if (!token || !TOKEN_PATTERN.test(token)) {
      return unauthorized(res, token !== undefined);
    }

    try {
      const found = await store.findSession(hashToken(token));

      if (!found) {
        return unauthorized(res, true);
      }

      if (found.session.expiresAt.getTime() <= now()) {
        await store.deleteSession(found.session.id);
        return unauthorized(res, true);
      }

      if (!found.user.active) {
        return unauthorized(res, true);
      }

      res.locals.auth = {
        user: { id: found.user.id, email: found.user.email, role: found.user.role },
        session: {
          id: found.session.id,
          csrfToken: found.session.csrfToken,
          expiresAt: found.session.expiresAt,
        },
      } satisfies AuthContext;

      noStore(res);
      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Authentication check failed" });
    }
  };

  const requireCsrf: RequestHandler = (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    const auth = res.locals.auth;

    if (!auth) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = req.get("x-csrf-token");

    if (!token || !tokensEqual(token, auth.session.csrfToken)) {
      return res.status(403).json({ error: "Invalid or missing CSRF token" });
    }

    next();
  };

  function requireRole(...roles: Role[]): RequestHandler {
    return (_req: Request, res: Response, next: NextFunction) => {
      const auth = res.locals.auth;

      if (!auth) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!roles.includes(auth.user.role)) {
        return res.status(403).json({ error: "You do not have permission to do this" });
      }

      next();
    };
  }

  function sessionResponse(auth: AuthContext) {
    return {
      user: { email: auth.user.email, role: auth.user.role },
      csrfToken: auth.session.csrfToken,
      expiresAt: auth.session.expiresAt.toISOString(),
    };
  }

  const router = express.Router();

  router.post("/auth/login", async (req, res) => {
    noStore(res);

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    // A cross-site HTML form can't send JSON without a CORS preflight.
    if (!req.is("application/json")) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.trim() === "" ||
      password === "" ||
      email.length > MAX_EMAIL_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const ipKey = `ip:${req.ip ?? "unknown"}`;
    const emailKey = `email:${normalizedEmail}`;
    const blocked = [limiter.check(ipKey), limiter.check(emailKey)].find((result) => result.blocked);

    if (blocked) {
      res.setHeader("Retry-After", String(blocked.retryAfterSeconds));
      return res.status(429).json({ error: "Too many failed login attempts. Try again later." });
    }

    // Counted before the first await, so concurrent requests can't all pass the
    // check above. The attempt stands unless the login succeeds or the server
    // fails.
    limiter.recordAttempt(ipKey);
    limiter.recordAttempt(emailKey);

    try {
      const user = await store.findUserByEmail(normalizedEmail);
      // Always run one password check, so unknown emails take as long.
      const passwordMatches = await verifyPassword(
        user?.passwordHash ?? (await getDummyPasswordHash()),
        password,
      );

      if (!user || !user.active || !passwordMatches) {
        return res.status(401).json({ error: LOGIN_FAILED_MESSAGE });
      }

      const token = generateToken();
      const csrfToken = generateToken();
      const expiresAt = new Date(now() + config.sessionTtlSeconds * 1000);

      await store.deleteExpiredSessions(new Date(now()));
      await store.createSession({ userId: user.id, tokenHash: hashToken(token), csrfToken, expiresAt });

      // Clears the email's failures. The address keeps its earlier failures, so
      // logging in to one account can't reset the limit for guessing at others.
      limiter.reset(emailKey);
      limiter.release(ipKey);

      res.setHeader("Set-Cookie", sessionCookie(config, token));
      return res.json({
        user: { email: user.email, role: user.role },
        csrfToken,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      // A server failure says nothing about the password.
      limiter.release(ipKey);
      limiter.release(emailKey);
      console.error(error);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  router.get("/auth/me", requireAuth, (_req, res) => {
    noStore(res);
    res.json(sessionResponse(res.locals.auth!));
  });

  router.post("/auth/logout", requireAuth, requireCsrf, async (_req, res) => {
    noStore(res);

    try {
      await store.deleteSession(res.locals.auth!.session.id);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Logout failed" });
    }

    res.setHeader("Set-Cookie", clearedSessionCookie(config));
    res.status(204).end();
  });

  return { router, requireAuth, requireCsrf, requireRole, corsOptions: corsOptions(config) };
}
