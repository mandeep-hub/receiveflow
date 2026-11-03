// What the User Management page offers, and its API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageUsers,
  canReactivate,
  canResetOrDeactivate,
  passwordProblem,
  type ManagedUser,
} from "../src/users/userRules.ts";
import { createUsersApi, UserRequestError } from "../src/users/usersApi.ts";

const user = (role: ManagedUser["role"], active: boolean): ManagedUser => ({
  id: 7,
  email: "user@example.test",
  role,
  active,
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

// Records each call and answers with the given response.
function recording(response: () => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createUsersApi(async (path, init) => {
    calls.push({ path, init });
    return response();
  });

  return { api, calls };
}

test("only an ADMIN can open User Management", () => {
  assert.equal(canManageUsers("ADMIN"), true);
  assert.equal(canManageUsers("WAREHOUSE"), false);
});

test("ADMIN accounts are offered no actions, active or not", () => {
  for (const active of [true, false]) {
    assert.equal(canResetOrDeactivate(user("ADMIN", active)), false);
    assert.equal(canReactivate(user("ADMIN", active)), false);
  }
});

test("an active WAREHOUSE user can be reset or deactivated; an inactive one only reactivated", () => {
  assert.equal(canResetOrDeactivate(user("WAREHOUSE", true)), true);
  assert.equal(canReactivate(user("WAREHOUSE", true)), false);
  assert.equal(canResetOrDeactivate(user("WAREHOUSE", false)), false);
  assert.equal(canReactivate(user("WAREHOUSE", false)), true);
});

test("a new password must be long enough and typed the same twice", () => {
  const good = "Long-Enough-Password-1";

  assert.equal(passwordProblem(good, good), null);
  assert.equal(passwordProblem("x".repeat(12), "x".repeat(12)), null);
  assert.match(passwordProblem("short", "short") ?? "", /at least 12/);
  assert.match(passwordProblem("x".repeat(1025), "x".repeat(1025)) ?? "", /at most 1024/);
  assert.match(passwordProblem(good, `${good}x`) ?? "", /do not match/);
});

test("the API calls use the right paths, and only the password calls send a body", async () => {
  const { api, calls } = recording(() => json(200, []));

  await api.list();
  await api.create("a@example.test", "Long-Enough-Password-1");
  await api.resetPassword(7, "Long-Enough-Password-2");
  await api.deactivate(7);
  await api.reactivate(7);

  assert.deepEqual(
    calls.map((call) => [call.init?.method ?? "GET", call.path]),
    [
      ["GET", "/users"],
      ["POST", "/users"],
      ["POST", "/users/7/reset-password"],
      ["POST", "/users/7/deactivate"],
      ["POST", "/users/7/reactivate"],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.init?.body),
    [
      undefined,
      JSON.stringify({ email: "a@example.test", password: "Long-Enough-Password-1" }),
      JSON.stringify({ password: "Long-Enough-Password-2" }),
      undefined,
      undefined,
    ],
  );
});

test("a refused request shows the API's message, or a fallback if there is none", async () => {
  await assert.rejects(
    recording(() => json(409, { error: "A user with this email already exists" })).api.create("a@example.test", "x"),
    (error: unknown) => error instanceof UserRequestError && error.message === "A user with this email already exists",
  );

  await assert.rejects(
    recording(() => new Response("not json", { status: 500 })).api.deactivate(7),
    (error: unknown) => error instanceof UserRequestError && error.message === "Failed to deactivate user",
  );
});

test("no response from the server is reported as unreachable", async () => {
  const api = createUsersApi(async () => {
    throw new TypeError("Failed to fetch");
  });

  await assert.rejects(
    api.list(),
    (error: unknown) => error instanceof UserRequestError && /could not be reached/.test(error.message),
  );
});
