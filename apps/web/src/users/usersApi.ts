// The /users API calls. `send` is apiFetch in the app (src/api/users.ts), which
// adds the session cookie and the CSRF token; tests pass their own.
import type { ManagedUser } from "./userRules.ts";

type Send = (path: string, init?: RequestInit) => Promise<Response>;

// A failed request, with a message that can be shown to the user as is.
export class UserRequestError extends Error {}

export function createUsersApi(send: Send) {
  async function request(path: string, failure: string, init?: RequestInit) {
    let response: Response;

    try {
      response = await send(path, init);
    } catch {
      throw new UserRequestError("The server could not be reached. Please try again.");
    }

    const result: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message = (result as { error?: unknown } | null)?.error;
      throw new UserRequestError(typeof message === "string" ? message : failure);
    }

    return result;
  }

  function postJson(path: string, failure: string, body: unknown) {
    return request(path, failure, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return {
    list: () => request("/users", "Failed to fetch users") as Promise<ManagedUser[]>,

    create: (email: string, password: string) =>
      postJson("/users", "Failed to create user", { email, password }),

    resetPassword: (id: number, password: string) =>
      postJson(`/users/${id}/reset-password`, "Failed to reset password", { password }),

    deactivate: (id: number) =>
      request(`/users/${id}/deactivate`, "Failed to deactivate user", { method: "POST" }),

    reactivate: (id: number) =>
      request(`/users/${id}/reactivate`, "Failed to reactivate user", { method: "POST" }),
  };
}
