// F-63 createRateLimiter and F-65 rateLimited and the coarse per-IP limit.
import rateLimit from "@fastify/rate-limit";
import type { Clock } from "@budmon/shared";
import { os } from "@orpc/server";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/types.js";
import { RateLimitedError } from "../errors/platformErrors.js";
import type { RequestContext } from "../http/context.js";
import { TOKEN } from "../observability/safeFields.js";
import { hmacSha256 } from "./hashing.js";
import { incrementWindow } from "./rateLimitRepo.js";

export interface RateLimitSpec {
  limiter: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimiter {
  hit(
    spec: RateLimitSpec,
    subject: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number; hits: number }>;
}

export function createRateLimiter(deps: { db: Database; key: Buffer; clock: Clock }): RateLimiter {
  return {
    async hit(spec, subject) {
      if (!TOKEN.test(spec.limiter)) throw new RangeError("rate limiter name is invalid");
      if (!Number.isInteger(spec.limit) || spec.limit < 1) {
        throw new RangeError("rate limit must be at least 1");
      }
      if (!Number.isInteger(spec.windowSeconds) || spec.windowSeconds < 1) {
        throw new RangeError("rate limit window must be at least 1 second");
      }
      const nowMs = deps.clock.now().epochMilliseconds;
      const windowMs = spec.windowSeconds * 1000;
      const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
      // The subject (an IP, an email) is never stored: only its HMAC.
      const bucketKey = `${spec.limiter}:${hmacSha256(deps.key, subject).toString("base64url")}`;
      // The pool's handle: autocommit, outside any caller transaction, so a rolled-back request
      // still counts.
      const hits = await incrementWindow(
        deps.db.handle,
        bucketKey,
        new Date(windowStartMs),
        new Date(windowStartMs + 2 * windowMs),
      );
      const allowed = hits <= spec.limit;
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
      return { allowed, retryAfterSeconds, hits };
    },
  };
}

/** F-65: each rule with a subject is checked in order; the first refusal throws. */
export function rateLimited(
  ...rules: {
    spec: RateLimitSpec;
    subject: (input: unknown, ctx: RequestContext) => string | null;
  }[]
) {
  return os.$context<RequestContext>().middleware(async ({ context, next }, input: unknown) => {
    for (const rule of rules) {
      const subject = rule.subject(input, context);
      if (subject === null) continue;
      const result = await context.container.rateLimiter.hit(rule.spec, subject);
      if (!result.allowed) {
        context.container.metrics.rateLimited.add(1, { limiter: rule.spec.limiter });
        throw new RateLimitedError(result.retryAfterSeconds);
      }
    }
    return next();
  });
}

/** Thrown by the coarse limit; F-62's error handler answers it with the 429 envelope. */
export class CoarseRateLimitError extends Error {
  readonly code = "BUDMON_RATE_LIMITED";
  readonly statusCode = 429;
  constructor(readonly retryAfterSeconds: number) {
    super("rate limited");
  }
}

/** F-65's coarse limit: 300 requests a minute per client IP, health checks exempt. */
export async function registerCoarseRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
    keyGenerator: (request) => request.ip,
    allowList: (request) => request.url.startsWith("/health/"),
    // Only Retry-After: the counters say nothing a client needs.
    addHeaders: {
      "x-ratelimit-limit": false,
      "x-ratelimit-remaining": false,
      "x-ratelimit-reset": false,
      "retry-after": true,
    },
    addHeadersOnExceeding: {
      "x-ratelimit-limit": false,
      "x-ratelimit-remaining": false,
      "x-ratelimit-reset": false,
    },
    errorResponseBuilder: (_request, context) =>
      new CoarseRateLimitError(Math.max(1, Math.ceil(context.ttl / 1000))),
  });
}
