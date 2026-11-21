// F-29: identity's rate limits (LD-1) over P-F-63's limiter.
import { RateLimitedError } from "../platform/errors/platformErrors.js";
import type { RateLimitSpec } from "../platform/security/rateLimiter.js";
import type { IdentityDeps } from "./identityModule.js";

export type IdentityLimiter =
  | "signin.ip"
  | "signin.email-ip"
  | "signin.email-unknown-device"
  | "signin.email-device"
  | "twostep.ip"
  | "twostep.totp-user"
  | "twostep.totp-user-day"
  | "refresh.ip"
  | "refresh.session"
  | "google.ip"
  | "reset.ip"
  | "reset.email"
  | "token.ip"
  | "confirm.ip"
  | "confirm.user"
  | "invite.user"
  | "invite.resend"
  | "lookup.user";

const spec = (limiter: IdentityLimiter, limit: number, windowSeconds: number): RateLimitSpec => ({
  limiter,
  limit,
  windowSeconds,
});

export const IDENTITY_LIMITS: Readonly<Record<IdentityLimiter, RateLimitSpec>> = {
  "signin.ip": spec("signin.ip", 30, 600),
  "signin.email-ip": spec("signin.email-ip", 10, 900),
  "signin.email-unknown-device": spec("signin.email-unknown-device", 30, 3600),
  "signin.email-device": spec("signin.email-device", 10, 900),
  "twostep.ip": spec("twostep.ip", 30, 600),
  "twostep.totp-user": spec("twostep.totp-user", 10, 900),
  "twostep.totp-user-day": spec("twostep.totp-user-day", 30, 86400),
  "refresh.ip": spec("refresh.ip", 120, 600),
  "refresh.session": spec("refresh.session", 30, 600),
  "google.ip": spec("google.ip", 60, 600),
  "reset.ip": spec("reset.ip", 10, 3600),
  "reset.email": spec("reset.email", 3, 3600),
  "token.ip": spec("token.ip", 30, 600),
  "confirm.ip": spec("confirm.ip", 30, 600),
  "confirm.user": spec("confirm.user", 10, 900),
  "invite.user": spec("invite.user", 20, 86400),
  "invite.resend": spec("invite.resend", 3, 86400),
  "lookup.user": spec("lookup.user", 30, 3600),
};

/**
 * Hits each rule in order; the first refusal throws RATE_LIMITED and the rest aren't hit. Each hit
 * commits on its own, so a rolled-back request still counts.
 */
export async function hitLimits(
  deps: Pick<IdentityDeps, "rateLimiter" | "platformMetrics">,
  rules: readonly { limiter: IdentityLimiter; subject: string }[],
): Promise<void> {
  if (rules.length === 0) return;
  const { rateLimiter } = deps;
  if (rateLimiter === null) throw new Error("identity: rateLimiter unavailable");
  for (const rule of rules) {
    const result = await rateLimiter.hit(IDENTITY_LIMITS[rule.limiter], rule.subject);
    if (!result.allowed) {
      deps.platformMetrics.rateLimited.add(1, { limiter: rule.limiter });
      throw new RateLimitedError(result.retryAfterSeconds);
    }
  }
}
