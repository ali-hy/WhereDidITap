// F-27 deliverSession, deliverChallenge and clearSessionCookies (identity LLD §4.1). TP-0.14, plus
// extra cases TP-0.14x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// `now` for the refresh cookie's Max-Age is ctx.container.clock (A-2), fixed here so the value is
// exact.
import { fixedClock, Temporal } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../../../src/platform/http/context.js";
import {
  clearSessionCookies,
  deliverChallenge,
  deliverSession,
} from "../../../src/identity/deliver.js";
import type { IssuedSession } from "../../../src/identity/sessionService.js";

const NOW = Temporal.Instant.from("2026-11-02T10:00:00Z");
const ACCESS = `bma_${"A".repeat(43)}`;
const REFRESH = `bmr_${"R".repeat(43)}`;
const DEVICE = `bmd_${"D".repeat(43)}`;
const CHALLENGE = `bmc_${"C".repeat(43)}`;
const ATTRS = "HttpOnly; Secure; SameSite=Strict";

function fakeCtx(host: string): RequestContext & { resHeaders: Headers } {
  const resHeaders = new Headers();
  return {
    headers: { host },
    resHeaders,
    responseHeaders: resHeaders,
    container: { clock: fixedClock(NOW) },
  } as unknown as RequestContext & { resHeaders: Headers };
}

function session(over: Partial<IssuedSession> = {}): IssuedSession {
  return {
    sessionId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a20",
    userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a21",
    accessToken: ACCESS,
    refreshToken: REFRESH,
    accessExpiresAt: NOW.add({ minutes: 15 }),
    refreshExpiresAt: NOW.add({ hours: 24 * 30 }),
    delivery: "cookie",
    deviceToken: DEVICE,
    ...over,
  };
}

const setCookies = (ctx: { resHeaders: Headers }): string[] => ctx.resHeaders.getSetCookie();

describe("TP-0.14: deliverSession and clearSessionCookies", () => {
  it("TP-0.14: cookie delivery on x.ts.net with a device token appends 4 prefixed set-cookie values and returns null", () => {
    const ctx = fakeCtx("x.ts.net");

    const out = deliverSession(ctx, session());

    expect(out).toBeNull();
    expect(setCookies(ctx).sort()).toEqual(
      [
        `__Secure-budmon_at=${ACCESS}; Path=/api/v1; Max-Age=900; ${ATTRS}`,
        `__Secure-budmon_rt=${REFRESH}; Path=/api/v1/auth/refresh; Max-Age=2592000; ${ATTRS}`,
        `__Secure-budmon_dv=${DEVICE}; Path=/api/v1; Max-Age=31536000; ${ATTRS}`,
        `__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; ${ATTRS}`,
      ].sort(),
    );
  });

  it("TP-0.14: on localhost:8080 the same cookies use the unprefixed names", () => {
    const ctx = fakeCtx("localhost:8080");

    deliverSession(ctx, session());

    expect(setCookies(ctx).sort()).toEqual(
      [
        `budmon_at=${ACCESS}; Path=/api/v1; Max-Age=900; ${ATTRS}`,
        `budmon_rt=${REFRESH}; Path=/api/v1/auth/refresh; Max-Age=2592000; ${ATTRS}`,
        `budmon_dv=${DEVICE}; Path=/api/v1; Max-Age=31536000; ${ATTRS}`,
        `budmon_2fa=; Path=/api/v1/auth; Max-Age=0; ${ATTRS}`,
      ].sort(),
    );
  });

  it("TP-0.14: bearer delivery returns the tokens with instants as YYYY-MM-DDTHH:MM:SS.sssZ and sets no cookie", () => {
    const ctx = fakeCtx("x.ts.net");

    const out = deliverSession(
      ctx,
      session({
        delivery: "bearer",
        accessExpiresAt: NOW.add({ minutes: 15, nanoseconds: 123_456_789 }),
      }),
    );

    expect(out).toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      accessExpiresAt: "2026-11-02T10:15:00.123Z",
      refreshExpiresAt: "2026-12-02T10:00:00.000Z",
      deviceToken: DEVICE,
    });
    expect(setCookies(ctx)).toEqual([]);
  });

  it("TP-0.14: clearSessionCookies clears access, refresh and challenge, never device", () => {
    const ctx = fakeCtx("x.ts.net");

    clearSessionCookies(ctx);

    expect(setCookies(ctx).sort()).toEqual(
      [
        `__Secure-budmon_at=; Path=/api/v1; Max-Age=0; ${ATTRS}`,
        `__Secure-budmon_rt=; Path=/api/v1/auth/refresh; Max-Age=0; ${ATTRS}`,
        `__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; ${ATTRS}`,
      ].sort(),
    );
  });
});

describe("TP-0.14x: deliver details", () => {
  it("TP-0.14x: cookie delivery without a device token sets no device cookie (3 values)", () => {
    const ctx = fakeCtx("x.ts.net");

    deliverSession(ctx, session({ deviceToken: null }));

    const names = setCookies(ctx).map((c) => c.slice(0, c.indexOf("=")));
    expect(names.sort()).toEqual([
      "__Secure-budmon_2fa",
      "__Secure-budmon_at",
      "__Secure-budmon_rt",
    ]);
  });

  it.each([
    ["now + 30 d", NOW.add({ hours: 24 * 30 }), "2592000"],
    [
      "now + 30 d − 1 ms (floored)",
      NOW.add({ hours: 24 * 30 }).subtract({ milliseconds: 1 }),
      "2591999",
    ],
    ["now − 1 s (never negative)", NOW.subtract({ seconds: 1 }), "0"],
  ])(
    "TP-0.14 (A-2): refreshExpiresAt = %s gives the refresh cookie Max-Age=%s",
    (_label, at, maxAge) => {
      const ctx = fakeCtx("x.ts.net");

      deliverSession(ctx, session({ refreshExpiresAt: at }));

      const refresh = setCookies(ctx).find((c) => c.startsWith("__Secure-budmon_rt="));
      expect(refresh).toContain(`; Max-Age=${maxAge};`);
    },
  );

  it("TP-0.14x: bearer delivery with no device token returns deviceToken null", () => {
    const out = deliverSession(
      fakeCtx("x.ts.net"),
      session({ delivery: "bearer", deviceToken: null }),
    );

    expect(out?.deviceToken).toBeNull();
  });

  it("TP-0.14x: clearSessionCookies on localhost clears the unprefixed names only", () => {
    const ctx = fakeCtx("127.0.0.1:5173");

    clearSessionCookies(ctx);

    expect(setCookies(ctx).every((c) => c.startsWith("budmon_"))).toBe(true);
    expect(setCookies(ctx)).toHaveLength(3);
  });

  it("TP-0.14x: deliverChallenge with cookie sets the challenge cookie (5 min) and returns null", () => {
    const ctx = fakeCtx("x.ts.net");

    const out = deliverChallenge(ctx, CHALLENGE, NOW.add({ minutes: 5 }), "cookie");

    expect(out).toBeNull();
    expect(setCookies(ctx)).toEqual([
      `__Secure-budmon_2fa=${CHALLENGE}; Path=/api/v1/auth; Max-Age=300; ${ATTRS}`,
    ]);
  });

  it("TP-0.14x: deliverChallenge with bearer returns the token and sets nothing", () => {
    const ctx = fakeCtx("x.ts.net");

    expect(deliverChallenge(ctx, CHALLENGE, NOW.add({ minutes: 5 }), "bearer")).toBe(CHALLENGE);
    expect(setCookies(ctx)).toEqual([]);
  });
});
