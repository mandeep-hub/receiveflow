// Listing users, and creating, resetting, deactivating and reactivating
// WAREHOUSE users. Used by the manage-users command (src/scripts/manage-users.ts)
// and the /users API routes (src/app.ts). Every change here is limited to
// WAREHOUSE users: ADMIN accounts are never changed. Password changes and
// deactivation also end that user's sessions, in one transaction.
//
// The caller passes in the Prisma client, so this file doesn't choose a database.
import type { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword, MAX_PASSWORD_LENGTH } from "./password.js";

export const MIN_PASSWORD_LENGTH = 12;
// Same limit and normalization as POST /auth/login (src/auth/index.ts).
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserAdminErrorKind = "invalid" | "not-found" | "conflict" | "forbidden";

// A refusal with a message that is safe to show as is.
export class UserAdminError extends Error {
  kind: UserAdminErrorKind;

  constructor(message: string, kind: UserAdminErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (normalized.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    throw new UserAdminError("that is not a valid email address", "invalid");
  }

  return normalized;
}

export function assertValidPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserAdminError(`the password must be at least ${MIN_PASSWORD_LENGTH} characters`, "invalid");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new UserAdminError(`the password must be at most ${MAX_PASSWORD_LENGTH} characters`, "invalid");
  }
}

// Never includes password hashes.
export function listUsers(db: PrismaClient) {
  return db.user.findMany({
    select: { id: true, email: true, role: true, active: true },
    orderBy: { email: "asc" },
  });
}

export async function assertEmailAvailable(db: PrismaClient, email: string) {
  const existing = await db.user.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true } });

  if (existing) {
    throw new UserAdminError("a user with this email already exists; nothing was changed", "conflict");
  }
}

export async function createWarehouseUser(db: PrismaClient, input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  assertValidPassword(input.password);
  await assertEmailAvailable(db, email);

  const passwordHash = await hashPassword(input.password);

  try {
    return await db.user.create({
      data: { email, passwordHash, role: "WAREHOUSE", active: true },
      select: { id: true, email: true, role: true, active: true },
    });
  } catch (error) {
    // Created by someone else since the check above.
    if ((error as { code?: unknown } | null)?.code === "P2002") {
      throw new UserAdminError("a user with this email already exists; nothing was changed", "conflict");
    }

    throw error;
  }
}

// The WAREHOUSE user with this email, or a refusal.
async function findWarehouseUser(db: PrismaClient, email: string) {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true, role: true, active: true },
  });

  if (!user) {
    throw new UserAdminError("no user has this email; nothing was changed", "not-found");
  }

  if (user.role !== "WAREHOUSE") {
    throw new UserAdminError("only WAREHOUSE users can be changed; nothing was changed", "forbidden");
  }

  return user;
}

// The active WAREHOUSE user with this email, or a refusal.
export async function findManagedUser(db: PrismaClient, email: string) {
  const user = await findWarehouseUser(db, email);

  if (!user.active) {
    throw new UserAdminError("this user is deactivated; nothing was changed", "conflict");
  }

  return user;
}

// Applies the change to one active WAREHOUSE user and ends their sessions,
// together or not at all. Returns how many sessions were ended.
async function changeUserAndEndSessions(
  db: PrismaClient,
  user: { id: number },
  data: { passwordHash: string } | { active: false },
) {
  return db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, role: "WAREHOUSE", active: true },
      data,
    });

    if (updated.count !== 1) {
      throw new UserAdminError("the user changed during this request; nothing was changed", "conflict");
    }

    const sessions = await tx.session.deleteMany({ where: { userId: user.id } });

    return sessions.count;
  });
}

export async function resetUserPassword(db: PrismaClient, input: { email: string; password: string }) {
  assertValidPassword(input.password);

  const user = await findManagedUser(db, input.email);
  const passwordHash = await hashPassword(input.password);
  const sessionsEnded = await changeUserAndEndSessions(db, user, { passwordHash });

  return { email: user.email, role: user.role, sessionsEnded };
}

export async function deactivateUser(db: PrismaClient, input: { email: string }) {
  const user = await findManagedUser(db, input.email);
  const sessionsEnded = await changeUserAndEndSessions(db, user, { active: false });

  return { email: user.email, role: user.role, sessionsEnded };
}

// The old password works again; there are no sessions to end, because
// deactivation ended them and a deactivated user can't log in.
export async function reactivateUser(db: PrismaClient, input: { email: string }) {
  const user = await findWarehouseUser(db, input.email);

  if (user.active) {
    throw new UserAdminError("this user is already active; nothing was changed", "conflict");
  }

  const updated = await db.user.updateMany({
    where: { id: user.id, role: "WAREHOUSE", active: false },
    data: { active: true },
  });

  if (updated.count !== 1) {
    throw new UserAdminError("the user changed during this request; nothing was changed", "conflict");
  }

  return { email: user.email, role: user.role };
}
