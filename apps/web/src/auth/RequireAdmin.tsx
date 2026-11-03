// Shows its children only to an ADMIN; anyone else goes to the main page. This
// only hides the page: the API refuses non-ADMIN requests itself.
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { canManageUsers } from "@/users/userRules";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { state } = useAuth();

  if (state.status !== "authenticated" || !canManageUsers(state.user.role)) {
    return <Navigate to="/purchase-orders" replace />;
  }

  return <>{children}</>;
}
