// Whether a logout counts as done. Uses only Node's built-in test runner and
// type stripping, so the frontend needs no extra test dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogoutError, requestLogout } from "../src/auth/logoutRequest.ts";

const answering = (status: number) => async () => new Response(null, { status });

test("logout succeeds on 204", async () => {
  await requestLogout(answering(204));
});

test("logout succeeds on 401, because the session has already ended", async () => {
  await requestLogout(answering(401));
});

test("a refused or failed logout throws and says the user is still logged in", async () => {
  for (const status of [403, 429, 500, 503]) {
    await assert.rejects(
      requestLogout(answering(status)),
      (error: unknown) =>
        error instanceof LogoutError &&
        error.message === "Logging out failed. You are still logged in. Please try again.",
      String(status),
    );
  }
});

test("no response from the server throws and says the user is still logged in", async () => {
  await assert.rejects(
    requestLogout(async () => {
      throw new TypeError("Failed to fetch");
    }),
    (error: unknown) =>
      error instanceof LogoutError &&
      error.message === "The server could not be reached. You are still logged in. Please try again.",
  );
});
