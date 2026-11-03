// Holds the logged-in user and the session's CSRF token.
// - On page load it asks GET /auth/me whether the session cookie is still
//   valid (200 = logged in, 401 = not logged in).
// - login(): POST /auth/login with { email, password }; the API sets the
//   HttpOnly session cookie and returns { user, csrfToken, expiresAt }.
// - logout(): POST /auth/logout (with the CSRF token); the API deletes the
//   session and clears the cookie. If that fails, the user stays logged in.
// - Any other API call answered with 401 means the session has ended: the
//   user is shown the login page with a short explanation.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, setCsrfToken, setUnauthorizedHandler } from "@/api/client";
import {
  AuthContext,
  LoginError,
  type AuthState,
  type AuthUser,
} from "@/auth/authContext";
import { requestLogout } from "@/auth/logoutRequest";

type SessionResponse = {
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
};

const SESSION_ENDED = "Your session has ended. Please log in again.";
const SERVER_UNREACHABLE = "The server could not be reached. Please try again.";

function isSessionResponse(value: unknown): value is SessionResponse {
  const body = value as Partial<SessionResponse> | null;

  return (
    typeof body?.user?.email === "string" &&
    (body.user.role === "ADMIN" || body.user.role === "WAREHOUSE") &&
    typeof body.csrfToken === "string" &&
    body.csrfToken.length > 0
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const becomeAnonymous = useCallback((notice: string | null) => {
    setCsrfToken(null);
    setState({ status: "anonymous", notice });
  }, []);

  const becomeAuthenticated = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrfToken);
    setState({ status: "authenticated", user: session.user });
  }, []);

  // A 401 from any normal API call ends the session in the app as well.
  useEffect(() => {
    setUnauthorizedHandler(() => becomeAnonymous(SESSION_ENDED));
    return () => setUnauthorizedHandler(null);
  }, [becomeAnonymous]);

  // On page load: is the session cookie still valid?
  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const response = await apiFetch("/auth/me");
        const body = response.ok ? await response.json().catch(() => null) : null;

        if (cancelled) return;

        if (isSessionResponse(body)) {
          becomeAuthenticated(body);
        } else {
          becomeAnonymous(null);
        }
      } catch {
        if (!cancelled) becomeAnonymous(SERVER_UNREACHABLE);
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [becomeAnonymous, becomeAuthenticated]);

  const login = useCallback(
    async (email: string, password: string) => {
      let response: Response;

      try {
        response = await apiFetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new LoginError(SERVER_UNREACHABLE);
      }

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok || !isSessionResponse(body)) {
        const message = (body as { error?: unknown } | null)?.error;
        throw new LoginError(
          typeof message === "string" ? message : "Login failed. Please try again.",
        );
      }

      becomeAuthenticated(body);
    },
    [becomeAuthenticated],
  );

  // Throws a LogoutError and stays logged in if the API didn't end the session.
  const logout = useCallback(async () => {
    await requestLogout(() => apiFetch("/auth/logout", { method: "POST" }));
    becomeAnonymous(null);
  }, [becomeAnonymous]);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
