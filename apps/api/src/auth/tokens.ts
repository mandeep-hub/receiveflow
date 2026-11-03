// Session and CSRF tokens, and the session cookie.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthConfig } from "./config.js";

// 32 random bytes, base64url encoded (always 43 characters).
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Only this hash of the session token is stored in the database.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Constant-time comparison, so the time taken doesn't reveal how much matched.
export function tokensEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);

  return first.length === second.length && timingSafeEqual(first, second);
}

// Parses a Cookie header. Malformed parts are ignored; the first value of a
// name wins. Values are not decoded (our tokens never need decoding).
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name && !cookies.has(name)) {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function cookieAttributes(config: AuthConfig, maxAgeSeconds: number) {
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${config.secureCookies ? "; Secure" : ""}`;
}

export function sessionCookie(config: AuthConfig, token: string): string {
  return `${config.cookieName}=${token}; ${cookieAttributes(config, config.sessionTtlSeconds)}`;
}

export function clearedSessionCookie(config: AuthConfig): string {
  return `${config.cookieName}=; ${cookieAttributes(config, 0)}`;
}
