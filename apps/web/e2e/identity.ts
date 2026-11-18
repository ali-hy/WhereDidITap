// Identity's Playwright fixture and helpers (identity LLD §10.1; test-architect).
//
// - test: fixtures.ts's test, with each test's browser context and `request` sending a unique
//   X-Forwarded-For (10.<worker>.<n>.<m>), so F-29's per-IP limits never couple tests.
// - uniqueEmail(): a fresh address for a test's own user.
// - createInvitation(request, body): POST /api/v1/__test/invitations → { token, invitationId }.
// - signUpThroughUi(page, token, name): /invite#t=… → Use a password → Create account.
// - createUser(request, opts): a user made through the API only (no session in the browser).
// - submitSignIn(page, email, password, path): the S-3 sign-in form, submitted.
// - signInByApi(request, email): auth.signIn with body delivery → the session's tokens.
// - accountMenuButton(page), signOutFromMenu(page): F-162's account menu (A-76).
// - TestAuthenticator: §10.1's RFC 6238 helper for a two-step user (S-4).
// - enableTwoStep(page, opts): turns two-step on from Sign-in & security's Turn on (S-4).
// - unconfirmSessions(request, email): §10.1's step-up test route (S-4).
import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { APIRequestContext, Locator } from "@playwright/test";
import { catalogText, expect, test as base, type Page } from "./fixtures.js";

let perWorker = 0;
/** A random start per worker process, so reruns against a reused stack don't reuse IPs. */
const RUN_BASE = randomInt(0, 1 << 16);

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    perWorker += 1;
    const n = (RUN_BASE + perWorker + 1000 * testInfo.retry) & 0xffff;
    const ip = `10.${String(testInfo.parallelIndex % 256)}.${String((n >> 8) & 255)}.${String(n & 255)}`;
    await use({ ...extraHTTPHeaders, "X-Forwarded-For": ip });
  },
});

export { catalogText, expect };

/**
 * `text` as a whole-string pattern that tolerates ar-XB's marks anywhere: RLMs around each literal
 * segment and isolates around values (a message with values has marks inside it).
 */
export function looseText(text: string): RegExp {
  const marks = "[\\u200f\\u2068\\u2069]*";
  const chars = Array.from(text).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${marks}${chars.join(marks)}${marks}$`);
}

export type { Page };

/** A fresh address for one test's own user. */
export const uniqueEmail = (): string => `e2e-${randomUUID()}@example.invalid`;

/** The password every e2e sign-up uses: 12+ characters, not common, no email local part. */
export const E2E_PASSWORD = "violet staircase umbrella";

export interface TestInvitation {
  token: string;
  invitationId: string;
}

/** §10.1's test route: a direct invitation with a known token. */
export async function createInvitation(
  request: APIRequestContext,
  body: {
    email: string;
    inviterEmail?: string;
    state?: "pending" | "expired" | "revoked";
    expiresInSeconds?: number;
  },
): Promise<TestInvitation> {
  const res = await request.post("/api/v1/__test/invitations", { data: body });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as TestInvitation;
}

/** Waits for the invitation's join state: its h1 "You've been invited". */
export async function openInvitation(page: Page, token: string): Promise<void> {
  await page.goto(`/invite#t=${token}`);
  await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
}

/** Join → Use a password → Your name, Password → Create account; waits for the first-run home. */
export async function signUpThroughUi(page: Page, token: string, name: string): Promise<void> {
  await openInvitation(page, token);
  await page.getByRole("button", { name: catalogText("Use a password") }).click();
  await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));
  await page.getByLabel(catalogText("Your name")).fill(name);
  await page.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: catalogText("Create account") }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The accent token (--c-accent) as the browser computes it. */
export async function accentRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim();
    const probe = document.createElement("div");
    probe.style.color = raw;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });
}

/** Buttons and button-links in <main> painted with the accent fill: primary Buttons (A-515). */
export async function primaryCount(page: Page): Promise<number> {
  const accent = await accentRgb(page);
  return page
    .locator("main button, main a")
    .evaluateAll(
      (els, fill) => els.filter((el) => getComputedStyle(el).backgroundColor === fill).length,
      accent,
    );
}

/**
 * The on-screen toast showing `text`. The toaster also copies each message into the sr-only
 * `#live-polite` / `#live-assertive` regions (A-400), which are left out here.
 */
export function toastWith(page: Page, text: RegExp): Locator {
  return page.getByText(text).and(page.locator(":not(#live-polite):not(#live-assertive)"));
}

/**
 * The browser's cookie `name` for `page`'s host. Reads the whole jar: `context.cookies(url)` drops
 * Secure cookies for an http URL whose host isn't `localhost` (such as 127.0.0.1), though Chrome
 * stores and sends them.
 */
export async function jarCookie(page: Page, name: string) {
  const host = new URL(page.url()).hostname;
  return (await page.context().cookies()).find((c) => c.name === name && c.domain === host);
}

/** The X-Budmon-Client header of the e2e web build (build number 0; A-76). */
export const WEB_CLIENT = { "X-Budmon-Client": "web/0" } as const;

export interface TestUser {
  email: string;
  name: string;
}

/**
 * A user created through the API only (invitation + invitations.accept with body delivery), so
 * the browser has no session and no device cookie for it.
 */
export async function createUser(
  request: APIRequestContext,
  opts: { name?: string; locale?: "en" | "ar-XB" } = {},
): Promise<TestUser> {
  const email = uniqueEmail();
  const name = opts.name ?? "Test Person";
  const { token } = await createInvitation(request, { email });
  const res = await request.post("/api/v1/invitations/accept", {
    headers: WEB_CLIENT,
    data: {
      token,
      displayName: name,
      locale: opts.locale ?? "en",
      timeZone: "UTC",
      baseCurrency: "USD",
      method: { kind: "password", password: E2E_PASSWORD },
      tokenDelivery: "body",
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return { email, name };
}

/** Opens `path` (the sign-in page), fills Email and Password and presses Sign in. */
export async function submitSignIn(
  page: Page,
  email: string,
  password: string = E2E_PASSWORD,
  path = "/sign-in",
): Promise<void> {
  await page.goto(path);
  await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));
  await expect(page.getByLabel(catalogText("Email"))).toBeVisible();
  await page.getByLabel(catalogText("Email")).fill(email);
  await page.getByLabel(catalogText("Password")).fill(password);
  await page
    .locator("main")
    .getByRole("button", { name: catalogText("Sign in") })
    .click();
}

export interface ApiSession {
  accessToken: string;
  refreshToken: string;
}

/** auth.signIn with body delivery through `request` (a session the browser doesn't hold). */
export async function signInByApi(
  request: APIRequestContext,
  email: string,
  password: string = E2E_PASSWORD,
): Promise<ApiSession> {
  const res = await request.post("/api/v1/auth/sign-in", {
    headers: WEB_CLIENT,
    data: { email, password, tokenDelivery: "body" },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { status: string; tokens: ApiSession | null };
  expect(body.status).toBe("signed_in");
  expect(body.tokens).not.toBeNull();
  return body.tokens as ApiSession;
}

/** F-162's account menu trigger: the header's button named "Account" (`menu.account`, A-76). */
export const accountMenuButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: catalogText("Account") });

/** Opens the account menu and chooses Sign out. */
export async function signOutFromMenu(page: Page): Promise<void> {
  await expect(accountMenuButton(page)).toBeVisible();
  await accountMenuButton(page).click();
  await page.getByRole("menuitem", { name: catalogText("Sign out") }).click();
}

// ---- Two-step verification (S-4; §10.1 "A two-step user, and codes for it") ----

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 → bytes; spaces ignored, case-insensitive. */
export function base32Bytes(text: string): Buffer {
  const chars = text.replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of chars) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new RangeError(`not base32: ${c}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP for one 30-second step: HOTP with SHA-1, 6 digits, zero-padded. */
export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Seconds a chosen step must stay acceptable (s − 1 to s + 1) after it is picked. */
const STEP_MARGIN_SECONDS = 10;

/**
 * An authenticator app for one test's user. F-60 accepts steps s − 1 to s + 1 and skips any at
 * or below the last one used, so `nextCode` takes the lowest free step above the last it used
 * (with STEP_MARGIN_SECONDS of validity left) and waits for the next 30-second boundary when none
 * is free.
 */
export class TestAuthenticator {
  private lastStep: number | null = null;

  constructor(private readonly secret: Buffer) {}

  /** From the key the setup page shows (grouped in 4s). */
  static fromKey(key: string): TestAuthenticator {
    return new TestAuthenticator(base32Bytes(key));
  }

  private freeStep(): number | null {
    const now = Date.now() / 1000;
    const s = Math.floor(now / 30);
    for (const step of [s - 1, s, s + 1]) {
      if (this.lastStep !== null && step <= this.lastStep) continue;
      if ((step + 2) * 30 - now < STEP_MARGIN_SECONDS) continue;
      return step;
    }
    return null;
  }

  /** A code the server accepts once (marks its step used). */
  async nextCode(): Promise<string> {
    await expect.poll(() => this.freeStep(), { timeout: 45_000, intervals: [250] }).not.toBeNull();
    const step = this.freeStep();
    if (step === null) throw new Error("no free TOTP step");
    this.lastStep = step;
    return totpAt(this.secret, step);
  }

  /** Six digits that match none of the steps s − 2 to s + 2. */
  wrongCode(): string {
    const s = Math.floor(Date.now() / 30_000);
    const near = new Set([-2, -1, 0, 1, 2].map((d) => totpAt(this.secret, s + d)));
    for (let n = 0; ; n += 1) {
      const code = String(n).padStart(6, "0");
      if (!near.has(code)) return code;
    }
  }
}

/** A recovery code as F-61 formats it. */
export const RECOVERY_CODE = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/;

/** True when the response is a POST to `path`. */
export const isPost = (path: string) => (r: { url(): string; request(): { method(): string } }) =>
  new URL(r.url()).pathname === path && r.request().method() === "POST";

/**
 * Turns two-step on for the signed-in user in `page` (F-164, F-165): opens Sign-in & security,
 * presses Turn on (→ the setup page), reads the key it shows, enters a code and waits for the ten
 * recovery codes. With `acknowledge`, ticks the checkbox and presses Done (back on Sign-in &
 * security). The session must not need step-up.
 */
export async function enableTwoStep(
  page: Page,
  opts: { acknowledge: boolean },
): Promise<{ auth: TestAuthenticator; codes: string[] }> {
  await page.goto("/settings/security");
  await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
  const setup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));
  await page
    .locator("main")
    .getByRole("button", { name: catalogText("Turn on") })
    .click();
  await expect(page).toHaveURL(/\/settings\/security\/two-step$/);
  const setupAnswer = await setup;
  expect(setupAnswer.status(), await setupAnswer.text()).toBe(200);
  const { secret } = (await setupAnswer.json()) as { secret: string };
  await expect(page.locator("main").getByText(secret, { exact: true })).toBeVisible();
  const auth = TestAuthenticator.fromKey(secret);

  const enable = page.waitForResponse(isPost("/api/v1/me/two-step/enable"));
  await page
    .locator("main")
    .getByLabel(catalogText("Code"))
    .fill(await auth.nextCode());
  await page
    .locator("main")
    .getByRole("button", { name: catalogText("Verify and turn on") })
    .click();
  const enableAnswer = await enable;
  expect(enableAnswer.status(), await enableAnswer.text()).toBe(200);
  const { recoveryCodes: codes } = (await enableAnswer.json()) as { recoveryCodes: string[] };
  expect(codes).toHaveLength(10);
  await expect(page.getByText(catalogText("Save your recovery codes"))).toBeVisible();
  for (const code of codes) await expect(page.getByText(code).first()).toBeVisible();

  if (opts.acknowledge) {
    await page.getByRole("checkbox", { name: catalogText("I've saved my recovery codes") }).check();
    await page.getByRole("button", { name: catalogText("Done") }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
  }
  return { auth, codes };
}

/** §10.1's test route: every live session of `email` needs step-up for its next sensitive action. */
export async function unconfirmSessions(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post("/api/v1/__test/sessions/unconfirm", { data: { email } });
  expect(res.status(), await res.text()).toBe(204);
}
