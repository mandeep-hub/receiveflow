// The Prisma implementation of AuthStore: the only auth file that touches the
// database. It needs the Prisma client generated from the User and Session
// models in prisma/schema.prisma.
import prisma from "../lib/prisma.js";
import { isRole, type AuthStore, type AuthUser } from "./types.js";

function toAuthUser(user: {
  id: number;
  email: string;
  role: string;
  active: boolean;
  passwordHash: string;
}): AuthUser {
  if (!isRole(user.role)) {
    throw new Error(`Unknown user role for user ${user.id}`);
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    passwordHash: user.passwordHash,
  };
}

export const prismaAuthStore: AuthStore = {
  async findUserByEmail(email) {
    const user = await prisma.user.findUnique({ where: { email } });
    return user ? toAuthUser(user) : null;
  },

  async createSession(data) {
    await prisma.session.create({ data });
  },

  async findSession(tokenHash) {
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      return null;
    }

    return {
      session: {
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      },
      user: toAuthUser(session.user),
    };
  },

  async deleteSession(id) {
    // deleteMany: already gone (e.g. a parallel logout) is not an error.
    await prisma.session.deleteMany({ where: { id } });
  },

  async deleteExpiredSessions(now) {
    await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  },
};
