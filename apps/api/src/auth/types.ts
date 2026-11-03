// Shared authentication types. Kept free of Prisma imports so the auth logic
// can be tested with an in-memory store, without a database.

export const ROLES = ["ADMIN", "WAREHOUSE"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type AuthUser = {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string;
};

export type SessionRecord = {
  id: number;
  userId: number;
  // SHA-256 (hex) of the cookie token; the token itself is never stored.
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
};

// What a request knows about its logged-in user (res.locals.auth).
export type AuthContext = {
  user: { id: number; email: string; role: Role };
  session: { id: number; csrfToken: string; expiresAt: Date };
};

// Everything the auth code needs from storage. The real implementation is
// src/auth/store.ts (Prisma); tests use an in-memory one.
export interface AuthStore {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createSession(data: {
    userId: number;
    tokenHash: string;
    csrfToken: string;
    expiresAt: Date;
  }): Promise<void>;
  findSession(tokenHash: string): Promise<{ session: SessionRecord; user: AuthUser } | null>;
  deleteSession(id: number): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<void>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      auth?: AuthContext;
    }
  }
}
