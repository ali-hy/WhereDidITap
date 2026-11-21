// F-4: cookie names, values and parsing (DV-3). `host` is the request's `Host` header.
import type { Temporal } from "@budmon/shared";

export type CookieName = "access" | "refresh" | "challenge" | "binding" | "device";

export const COOKIE_SPEC: Readonly<Record<CookieName, { base: string; path: string }>> = {
  access: { base: "budmon_at", path: "/api/v1" },
  refresh: { base: "budmon_rt", path: "/api/v1/auth/refresh" },
  challenge: { base: "budmon_2fa", path: "/api/v1/auth" },
  binding: { base: "budmon_gb", path: "/api/v1" },
  device: { base: "budmon_dv", path: "/api/v1" },
};

const LOCALHOST = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

export function isLocalhostHost(host: string | undefined): boolean {
  return host !== undefined && LOCALHOST.test(host);
}

/** Unprefixed on localhost, `__Secure-` everywhere else (a missing host counts as not localhost). */
export function cookieNameFor(name: CookieName, host: string | undefined): string {
  const { base } = COOKIE_SPEC[name];
  return isLocalhostHost(host) ? base : `__Secure-${base}`;
}

function cookieValue(
  name: CookieName,
  value: string,
  maxAgeSeconds: number,
  host: string | undefined,
): string {
  return `${cookieNameFor(name, host)}=${value}; Path=${COOKIE_SPEC[name].path}; Max-Age=${String(maxAgeSeconds)}; HttpOnly; Secure; SameSite=Strict`;
}

export function setCookie(
  name: CookieName,
  value: string,
  maxAge: Temporal.Duration,
  host: string | undefined,
): string {
  return cookieValue(name, value, Math.floor(maxAge.total({ unit: "seconds" })), host);
}

export function clearCookie(name: CookieName, host: string | undefined): string {
  return cookieValue(name, "", 0, host);
}

/** Reads only the name valid for the host; the other name is ignored. */
export function readCookie(
  name: CookieName,
  cookies: Readonly<Record<string, string>>,
  host: string | undefined,
): string | null {
  return cookies[cookieNameFor(name, host)] ?? null;
}

/** The first occurrence of each name; malformed pairs are skipped; values aren't decoded. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const key = pair.slice(0, eq);
    if (!Object.hasOwn(out, key)) out[key] = pair.slice(eq + 1);
  }
  return out;
}
