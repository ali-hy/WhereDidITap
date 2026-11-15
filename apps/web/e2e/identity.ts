// Identity's Playwright fixture and helpers (identity LLD §10.1; test-architect).
//
// - test: fixtures.ts's test, with each test's browser context and `request` sending a unique
//   X-Forwarded-For (10.<worker>.<n>.<m>), so F-29's per-IP limits never couple tests.
// - uniqueEmail(): a fresh address for a test's own user.
// - createInvitation(request, body): POST /api/v1/__test/invitations → { token, invitationId }.
// - signUpThroughUi(page, token, name): /invite#t=… → Use a password → Create account.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { catalogText, expect, test as base, type Page } from "./fixtures.js";

let perWorker = 0;

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    perWorker += 1;
    const n = perWorker + 1000 * testInfo.retry;
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
