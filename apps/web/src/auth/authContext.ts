// Shared auth types and the React context (no components here, so the
// react-refresh lint rule stays satisfied).
import { createContext } from "react";

export type UserRole = "ADMIN" | "WAREHOUSE";

export type AuthUser = {
  email: string;
  role: UserRole;
};

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; notice: string | null }
  | { status: "authenticated"; user: AuthUser };

export type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

// A failed login, with a message that can be shown to the user as is.
export class LoginError extends Error {}

export const AuthContext = createContext<AuthContextValue | null>(null);
