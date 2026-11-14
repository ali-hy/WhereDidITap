// F-4 cookies (identity LLD §4.1, DV-3). TP-0.3, plus extra cases TP-0.3x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import {
  COOKIE_SPEC,
  clearCookie,
  cookieNameFor,
  isLocalhostHost,
  parseCookies,
  readCookie,
  setCookie,
} from "../../../src/identity/cookies.js";

describe("TP-0.3: cookie names, values and parsing", () => {
  it.each([
    ["localhost:8080", "budmon_at"],
    ["127.0.0.1:5173", "budmon_at"],
    ["laptop.tail.ts.net", "__Secure-budmon_at"],
    [undefined, "__Secure-budmon_at"],
  ])("TP-0.3: cookieNameFor('access', %s) is %s", (host, name) => {
    expect(cookieNameFor("access", host)).toBe(name);
  });

  it("TP-0.3: setCookie('refresh', 'v', 30 days, 'x.ts.net') has the exact attributes", () => {
    expect(setCookie("refresh", "v", Temporal.Duration.from({ days: 30 }), "x.ts.net")).toBe(
      "__Secure-budmon_rt=v; Path=/api/v1/auth/refresh; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict",
    );
  });

  it("TP-0.3: with both names present, localhost reads the unprefixed one and x.ts.net the prefixed one", () => {
    const cookies = { budmon_at: "a", "__Secure-budmon_at": "b" };

    expect(readCookie("access", cookies, "localhost:8080")).toBe("a");
    expect(readCookie("access", cookies, "x.ts.net")).toBe("b");
  });

  it("TP-0.3: an unprefixed cookie sent to x.ts.net is ignored", () => {
    expect(readCookie("access", { budmon_at: "a" }, "x.ts.net")).toBeNull();
  });

  it("TP-0.3: a prefixed cookie sent to localhost is ignored", () => {
    expect(readCookie("access", { "__Secure-budmon_at": "b" }, "localhost")).toBeNull();
  });

  it('TP-0.3: parseCookies("a=1; b; c=2=3; a=9") keeps the first a, skips b, splits c at the first =', () => {
    expect(parseCookies("a=1; b; c=2=3; a=9")).toEqual({ a: "1", c: "2=3" });
  });
});

describe("TP-0.3x: cookie rules", () => {
  it("TP-0.3x: COOKIE_SPEC is F-4's table", () => {
    expect(COOKIE_SPEC).toEqual({
      access: { base: "budmon_at", path: "/api/v1" },
      refresh: { base: "budmon_rt", path: "/api/v1/auth/refresh" },
      challenge: { base: "budmon_2fa", path: "/api/v1/auth" },
      binding: { base: "budmon_gb", path: "/api/v1" },
      device: { base: "budmon_dv", path: "/api/v1" },
    });
  });

  it.each([
    ["localhost", true],
    ["LOCALHOST:8080", true],
    ["127.0.0.1", true],
    ["127.0.0.1:65535", true],
    ["localhost:123456", false],
    ["localhost.evil.com", false],
    ["evil-localhost", false],
    ["127.0.0.2", false],
    ["[::1]:8080", false],
    ["", false],
    [undefined, false],
  ])("TP-0.3x: isLocalhostHost(%j) is %s", (host, expected) => {
    expect(isLocalhostHost(host)).toBe(expected);
  });

  it("TP-0.3x: setCookie on localhost uses the unprefixed name, still Secure and HttpOnly, never a Domain", () => {
    const value = setCookie(
      "access",
      "tok",
      Temporal.Duration.from({ minutes: 15 }),
      "localhost:8080",
    );

    expect(value).toBe(
      "budmon_at=tok; Path=/api/v1; Max-Age=900; HttpOnly; Secure; SameSite=Strict",
    );
    expect(value).not.toMatch(/Domain=/i);
  });

  it("TP-0.3x: clearCookie is the same cookie with an empty value and Max-Age=0", () => {
    expect(clearCookie("challenge", "x.ts.net")).toBe(
      "__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
    );
    expect(clearCookie("device", "127.0.0.1:5173")).toBe(
      "budmon_dv=; Path=/api/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
    );
  });

  it("TP-0.3x: parseCookies of undefined or an empty header is {}", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("TP-0.3x: parseCookies trims pairs and doesn't URL-decode values", () => {
    expect(parseCookies("  x=a%20b ;y=bmr_A-_z  ")).toEqual({ x: "a%20b", y: "bmr_A-_z" });
  });

  it("TP-0.3x: readCookie with a missing host reads only the prefixed name", () => {
    expect(readCookie("refresh", { budmon_rt: "a" }, undefined)).toBeNull();
    expect(readCookie("refresh", { "__Secure-budmon_rt": "b" }, undefined)).toBe("b");
  });
});
