// Failed-login limiter. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoginRateLimiter } from "../../src/auth/rateLimit.ts";

function limiterWithClock(maxFailures = 3, windowMs = 60_000) {
  let time = 1_000_000;
  const limiter = createLoginRateLimiter({ maxFailures, windowMs, now: () => time });
  return { limiter, advance: (ms: number) => (time += ms) };
}

test("a key is blocked after maxFailures failures, with a Retry-After time", () => {
  const { limiter } = limiterWithClock(3, 60_000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(limiter.check("email:a").blocked, false);
    limiter.recordAttempt("email:a");
  }

  const result = limiter.check("email:a");
  assert.equal(result.blocked, true);
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(limiter.check("email:b").blocked, false, "other keys are unaffected");
});

test("the block ends when the window has passed", () => {
  const { limiter, advance } = limiterWithClock(2, 60_000);

  limiter.recordAttempt("ip:1");
  limiter.recordAttempt("ip:1");
  assert.equal(limiter.check("ip:1").blocked, true);

  advance(59_000);
  assert.equal(limiter.check("ip:1").blocked, true);
  assert.equal(limiter.check("ip:1").retryAfterSeconds, 1);

  advance(1_000);
  assert.equal(limiter.check("ip:1").blocked, false);
});

test("reset clears a key", () => {
  const { limiter } = limiterWithClock(1);

  limiter.recordAttempt("email:a");
  assert.equal(limiter.check("email:a").blocked, true);
  limiter.reset("email:a");
  assert.equal(limiter.check("email:a").blocked, false);
});

test("memory stays bounded by maxEntries", () => {
  let time = 0;
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 1_000, now: () => time, maxEntries: 3 });

  for (const key of ["a", "b", "c", "d", "e"]) {
    limiter.recordAttempt(key);
  }

  // Only the 3 newest keys are still tracked.
  assert.deepEqual(
    ["a", "b", "c", "d", "e"].map((key) => limiter.check(key).blocked),
    [false, false, true, true, true],
  );
  time += 1_000;
  assert.equal(limiter.check("e").blocked, false);
});

test("release takes back one attempt and leaves the others counted", () => {
  const { limiter } = limiterWithClock(2);

  limiter.recordAttempt("ip:1");
  limiter.recordAttempt("ip:1");
  assert.equal(limiter.check("ip:1").blocked, true);

  limiter.release("ip:1");
  assert.equal(limiter.check("ip:1").blocked, false);

  limiter.recordAttempt("ip:1");
  assert.equal(limiter.check("ip:1").blocked, true);
});

test("releasing the only attempt ends the window; releasing an unknown key does nothing", () => {
  const { limiter, advance } = limiterWithClock(2, 60_000);

  limiter.recordAttempt("ip:1");
  limiter.release("ip:1");
  limiter.release("ip:1");
  limiter.release("ip:never-seen");

  // A new attempt starts a full window, and an over-release didn't add credit.
  advance(50_000);
  limiter.recordAttempt("ip:1");
  limiter.recordAttempt("ip:1");
  assert.equal(limiter.check("ip:1").blocked, true);
  assert.equal(limiter.check("ip:1").retryAfterSeconds, 60);
});
