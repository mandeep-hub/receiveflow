// In-memory limiter for failed logins: at most `maxFailures` per key within a
// fixed window. Enough for a single API instance; with several instances,
// each would count separately.
//
// An attempt is recorded before its password check and counts as a failure
// unless it is released, so concurrent requests can't all pass check() before
// any failure is recorded. check() and recordAttempt() must run with no await
// between them.
export type LoginRateLimiter = {
  check(key: string): { blocked: boolean; retryAfterSeconds: number };
  recordAttempt(key: string): void;
  // Takes back one attempt that turned out not to be a failure.
  release(key: string): void;
  reset(key: string): void;
};

export function createLoginRateLimiter(options: {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
  maxEntries?: number;
}): LoginRateLimiter {
  const { maxFailures, windowMs, now = Date.now, maxEntries = 50_000 } = options;
  const entries = new Map<string, { failures: number; windowEndsAt: number }>();

  function current(key: string) {
    const entry = entries.get(key);

    if (entry && entry.windowEndsAt <= now()) {
      entries.delete(key);
      return undefined;
    }

    return entry;
  }

  // Keeps memory bounded: drop expired entries, then the oldest ones.
  function makeRoom() {
    if (entries.size < maxEntries) {
      return;
    }

    const time = now();

    for (const [key, entry] of entries) {
      if (entry.windowEndsAt <= time) {
        entries.delete(key);
      }
    }

    for (const key of entries.keys()) {
      if (entries.size < maxEntries) {
        break;
      }
      entries.delete(key);
    }
  }

  return {
    check(key) {
      const entry = current(key);

      if (!entry || entry.failures < maxFailures) {
        return { blocked: false, retryAfterSeconds: 0 };
      }

      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.windowEndsAt - now()) / 1000)),
      };
    },

    recordAttempt(key) {
      const entry = current(key);

      if (entry) {
        entry.failures += 1;
        return;
      }

      makeRoom();
      entries.set(key, { failures: 1, windowEndsAt: now() + windowMs });
    },

    release(key) {
      const entry = current(key);

      if (!entry) {
        return;
      }

      entry.failures -= 1;

      if (entry.failures <= 0) {
        entries.delete(key);
      }
    },

    reset(key) {
      entries.delete(key);
    },
  };
}
