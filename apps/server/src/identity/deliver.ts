// F-27: puts a session's tokens in cookies (web) or in the response body (Android).
import { Temporal, toInstantWire } from "@budmon/shared";
import type { RequestContext } from "../platform/http/context.js";
import { ACCESS_TTL, KNOWN_DEVICE_TTL, TWO_STEP_CHALLENGE_TTL } from "./constants.js";
import { clearCookie, setCookie, type CookieName } from "./cookies.js";
import type { IssuedSession } from "./sessionService.js";

export interface SessionTokensWire {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  deviceToken: string | null;
}

function appendCookie(
  ctx: RequestContext,
  name: CookieName,
  value: string,
  maxAge: Temporal.Duration,
): void {
  ctx.resHeaders.append("set-cookie", setCookie(name, value, maxAge, ctx.headers["host"]));
}

/** Cookie delivery sets the cookies and returns null; bearer delivery returns the tokens. */
export function deliverSession(ctx: RequestContext, s: IssuedSession): SessionTokensWire | null {
  if (s.delivery === "bearer") {
    return {
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      accessExpiresAt: toInstantWire(s.accessExpiresAt),
      refreshExpiresAt: toInstantWire(s.refreshExpiresAt),
      deviceToken: s.deviceToken,
    };
  }
  const now = ctx.container.clock.now();
  const remaining = Math.max(
    0,
    Math.floor(now.until(s.refreshExpiresAt).total({ unit: "seconds" })),
  );
  appendCookie(ctx, "access", s.accessToken, ACCESS_TTL);
  appendCookie(ctx, "refresh", s.refreshToken, Temporal.Duration.from({ seconds: remaining }));
  if (s.deviceToken !== null) appendCookie(ctx, "device", s.deviceToken, KNOWN_DEVICE_TTL);
  ctx.resHeaders.append("set-cookie", clearCookie("challenge", ctx.headers["host"]));
  return null;
}

/** A two-step challenge: a cookie (web) or the token itself (bearer). */
export function deliverChallenge(
  ctx: RequestContext,
  token: string,
  _expiresAt: Temporal.Instant,
  delivery: "cookie" | "bearer",
): string | null {
  if (delivery === "bearer") return token;
  appendCookie(ctx, "challenge", token, TWO_STEP_CHALLENGE_TTL);
  return null;
}

/** Clears access, refresh and challenge for the request's host; never `device`. */
export function clearSessionCookies(ctx: RequestContext): void {
  for (const name of ["access", "refresh", "challenge"] as const) {
    ctx.resHeaders.append("set-cookie", clearCookie(name, ctx.headers["host"]));
  }
}
