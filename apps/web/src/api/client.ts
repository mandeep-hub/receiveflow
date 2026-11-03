// Every API call goes through apiFetch. It:
// - sends the session cookie with every request (credentials: "include"),
// - adds the session's CSRF token (X-CSRF-Token) to state-changing requests,
//   as the API requires for POST, PUT, PATCH and DELETE,
// - reports a 401 from any non-auth endpoint as "the session has ended", so
//   the app can show the login page.
// The CSRF token is kept in memory only; after a page reload it is fetched
// again from /auth/me.
import { API_BASE_URL } from "@/api/config";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

// Network errors (no response at all) are passed on unchanged, so callers can
// still tell "no response" apart from an HTTP error.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (UNSAFE_METHODS.has(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });

  // The auth endpoints answer 401 as part of their normal flow (for example
  // "not logged in yet"); anywhere else it means the session has ended.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    unauthorizedHandler?.();
  }

  return response;
}
