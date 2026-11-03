// What the User Management page offers and accepts. The API enforces the same
// rules; these only keep the page from offering what it would refuse.
export type UserRole = "ADMIN" | "WAREHOUSE";

export type ManagedUser = {
  id: number;
  email: string;
  role: UserRole;
  active: boolean;
};

// Same limits as the API (apps/api/src/auth/userAdmin.ts).
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export function canManageUsers(role: UserRole) {
  return role === "ADMIN";
}

// ADMIN accounts can't be changed here.
export function canResetOrDeactivate(user: ManagedUser) {
  return user.role === "WAREHOUSE" && user.active;
}

export function canReactivate(user: ManagedUser) {
  return user.role === "WAREHOUSE" && !user.active;
}

// A message explaining what is wrong with the new password, or null.
export function passwordProblem(password: string, repeated: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }

  if (password !== repeated) {
    return "The passwords do not match.";
  }

  return null;
}
