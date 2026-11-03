// Password hashing with Argon2id (argon2 package). Only the hash is ever
// stored; it includes the algorithm, settings and random salt.
import { randomBytes } from "node:crypto";
import argon2 from "argon2";

// OWASP's recommended Argon2id baseline: 19 MiB memory, 2 passes, 1 lane.
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Longer input is refused before hashing, so huge bodies can't be used to
// make the server do expensive work.
export const MAX_PASSWORD_LENGTH = 1024;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

// False for a wrong password and for a malformed hash; never throws.
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

// A hash of a random value nobody knows. Logins for unknown emails are checked
// against it, so they take as long as a wrong password for a real user and
// response times don't reveal which emails exist.
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
}
