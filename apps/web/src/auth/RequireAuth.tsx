// Shows its children only to a logged-in user; everyone else is sent to the
// login page (including when the session ends while a page is open).
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();

  if (state.status === "loading") {
    return <p className="p-8 text-sm text-muted-foreground">Checking your session...</p>;
  }

  if (state.status === "anonymous") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
