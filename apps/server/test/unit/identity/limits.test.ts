// F-29 limits (identity LLD §4.1, LD-1). TP-0.15, plus extra cases TP-0.15x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../../src/platform/errors/platformErrors.js";
import type { PlatformMetrics } from "../../../src/platform/observability/metrics.js";
import { TOKEN } from "../../../src/platform/observability/safeFields.js";
import type { RateLimiter, RateLimitSpec } from "../../../src/platform/security/rateLimiter.js";
import { IDENTITY_LIMITS, hitLimits } from "../../../src/identity/limits.js";

/** A limiter that refuses the `deny`-th hit (1-based) with `retryAfterSeconds`. */
function fakeLimiter(deny: number, retryAfterSeconds = 42) {
  const hits: { spec: RateLimitSpec; subject: string }[] = [];
  const limiter: RateLimiter = {
    hit: vi.fn((spec: RateLimitSpec, subject: string) => {
      hits.push({ spec, subject });
      const allowed = hits.length !== deny;
      return Promise.resolve({
        allowed,
        retryAfterSeconds: allowed ? 0 : retryAfterSeconds,
        hits: 1,
      });
    }),
  };
  return { limiter, hits };
}

function fakeMetrics() {
  const add = vi.fn();
  return { metrics: { rateLimited: { add } } as unknown as PlatformMetrics, add };
}

const TABLE: [string, number, number][] = [
  ["signin.ip", 30, 600],
  ["signin.email-ip", 10, 900],
  ["signin.email-unknown-device", 30, 3600],
  ["signin.email-device", 10, 900],
  ["twostep.ip", 30, 600],
  ["twostep.totp-user", 10, 900],
  ["twostep.totp-user-day", 30, 86400],
  ["refresh.ip", 120, 600],
  ["refresh.session", 30, 600],
  ["google.ip", 60, 600],
  ["reset.ip", 10, 3600],
  ["reset.email", 3, 3600],
  ["token.ip", 30, 600],
  ["confirm.ip", 30, 600],
  ["confirm.user", 10, 900],
  ["invite.user", 20, 86400],
  ["invite.resend", 3, 86400],
  ["lookup.user", 30, 3600],
];

describe("TP-0.15: hitLimits", () => {
  it("TP-0.15: the 2nd rule refused → RATE_LIMITED with its retryAfterSeconds; the 3rd isn't hit; rate_limited_total{limiter=b} +1", async () => {
    const { limiter, hits } = fakeLimiter(2, 42);
    const { metrics, add } = fakeMetrics();

    const error = await hitLimits({ rateLimiter: limiter, platformMetrics: metrics }, [
      { limiter: "signin.ip", subject: "10.0.0.1" },
      { limiter: "signin.email-ip", subject: "mona@x.com|10.0.0.1" },
      { limiter: "signin.email-unknown-device", subject: "mona@x.com" },
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({
      key: "RATE_LIMITED",
      status: 429,
      details: { retryAfterSeconds: 42 },
    });
    expect(hits.map((h) => h.spec.limiter)).toEqual(["signin.ip", "signin.email-ip"]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, { limiter: "signin.email-ip" });
  });
});

describe("TP-0.15x: limits table and passes", () => {
  it("TP-0.15x: IDENTITY_LIMITS is F-29's table exactly", () => {
    expect(
      Object.values(IDENTITY_LIMITS)
        .map((s) => [s.limiter, s.limit, s.windowSeconds])
        .sort(),
    ).toEqual([...TABLE].sort());
    for (const [name, spec] of Object.entries(IDENTITY_LIMITS)) expect(spec.limiter).toBe(name);
  });

  it("TP-0.15x: every limiter name passes P-F-30's token rule", () => {
    for (const name of Object.keys(IDENTITY_LIMITS)) expect(TOKEN.test(name)).toBe(true);
  });

  it("TP-0.15x: all rules allowed → resolves, each hit once in order with its spec and subject, no metric", async () => {
    const { limiter, hits } = fakeLimiter(0);
    const { metrics, add } = fakeMetrics();

    await hitLimits({ rateLimiter: limiter, platformMetrics: metrics }, [
      { limiter: "reset.ip", subject: "10.0.0.2" },
      { limiter: "reset.email", subject: "mona@x.com" },
    ]);

    expect(hits).toEqual([
      { spec: IDENTITY_LIMITS["reset.ip"], subject: "10.0.0.2" },
      { spec: IDENTITY_LIMITS["reset.email"], subject: "mona@x.com" },
    ]);
    expect(add).not.toHaveBeenCalled();
  });

  it("TP-0.15x: no rules → resolves without hitting the limiter", async () => {
    const { limiter, hits } = fakeLimiter(1);
    const { metrics } = fakeMetrics();

    await hitLimits({ rateLimiter: limiter, platformMetrics: metrics }, []);

    expect(hits).toEqual([]);
  });

  it("TP-0.15x: the first rule refused → the rest aren't hit", async () => {
    const { limiter, hits } = fakeLimiter(1, 7);
    const { metrics } = fakeMetrics();

    await expect(
      hitLimits({ rateLimiter: limiter, platformMetrics: metrics }, [
        { limiter: "token.ip", subject: "10.0.0.3" },
        { limiter: "refresh.ip", subject: "10.0.0.3" },
      ]),
    ).rejects.toMatchObject({ details: { retryAfterSeconds: 7 } });
    expect(hits).toHaveLength(1);
  });
});
