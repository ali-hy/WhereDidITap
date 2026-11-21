// P-A-513 (3) theme-boot.js: <html data-theme data-mode> before first paint, from the device cache
// or the system (guide §3.5). TP-0b.4, plus extra cases TP-0b.4x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
//
// vite preview sends no CSP, so every page here is served with the production policy from
// infra/local/Caddyfile (added to the document response by the test), and the "no CSP violation"
// checks are real.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "./fixtures.js";

const CADDYFILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/local/Caddyfile",
);

/** The Caddyfile's Content-Security-Policy value (its first `header … Content-Security-Policy`). */
function productionCsp(): string {
  const match = /header\s+\??Content-Security-Policy\s+"([^"]+)"/.exec(
    readFileSync(CADDYFILE, "utf8"),
  );
  if (match?.[1] === undefined) throw new Error("no Content-Security-Policy in the Caddyfile");
  return match[1];
}

const servedWithCsp = new WeakSet<Page>();

/** Serves every document of `page` with the production CSP. */
async function withProductionCsp(page: Page): Promise<void> {
  const csp = productionCsp();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    servedWithCsp.add(page);
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
}

const KEY = "budmon.theme";

interface Boot {
  /** The attributes when <body> is first inserted: theme-boot.js in <head> has run, nothing painted. */
  body?: { theme: string | null; mode: string | null };
  /** The attributes at DOMContentLoaded (listener added before any app script). */
  dcl?: { theme: string | null; mode: string | null };
  csp: string[];
}

/** Records the attributes before first paint and any CSP violation; runs before every page script. */
async function recordBoot(page: Page): Promise<void> {
  await withProductionCsp(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __boot: Boot };
    w.__boot = { csp: [] };
    const read = () => ({
      theme: document.documentElement.getAttribute("data-theme"),
      mode: document.documentElement.getAttribute("data-mode"),
    });
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__boot.csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
    const observer = new MutationObserver(() => {
      if ((document.body as HTMLElement | null) !== null && w.__boot.body === undefined) {
        w.__boot.body = read();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      w.__boot.dcl = read();
    });
  });
}

/** Sets the device cache before any page script runs. */
async function cache(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ([key, v]) => {
      localStorage.setItem(key, v);
    },
    [KEY, value] as const,
  );
}

async function boot(page: Page): Promise<Boot> {
  await page.waitForLoadState("load");
  expect(servedWithCsp.has(page)).toBe(true);
  return page.evaluate(() => (window as unknown as { __boot: Boot }).__boot);
}

test.describe("TP-0b.4: the mode is set before first paint", () => {
  test.use({ colorScheme: "dark" });

  test('TP-0b.4: with the system dark and no cache, <html data-theme="teal" data-mode="dark"> is there before <body>, and again after a reload; no CSP violation', async ({
    page,
  }) => {
    await recordBoot(page);

    await page.goto("/");
    const first = await boot(page);
    await page.reload();
    const reloaded = await boot(page);

    for (const b of [first, reloaded]) {
      expect(b.body).toEqual({ theme: "teal", mode: "dark" });
      expect(b.dcl).toEqual({ theme: "teal", mode: "dark" });
      expect(b.csp).toEqual([]);
    }
  });

  test("TP-0b.4: a cached light overrides the dark system before first paint", async ({ page }) => {
    await cache(page, "light");
    await recordBoot(page);

    await page.goto("/");
    const b = await boot(page);

    expect(b.body).toEqual({ theme: "teal", mode: "light" });
    expect(b.dcl).toEqual({ theme: "teal", mode: "light" });
    expect(b.csp).toEqual([]);
  });

  test('TP-0b.4x: a cached "purple" reads as system (dark here)', async ({ page }) => {
    await cache(page, "purple");
    await recordBoot(page);

    await page.goto("/");

    expect((await boot(page)).body).toEqual({ theme: "teal", mode: "dark" });
  });

  test('TP-0b.4x: a cached "system" follows the system (dark here)', async ({ page }) => {
    await cache(page, "system");
    await recordBoot(page);

    await page.goto("/");

    expect((await boot(page)).body).toEqual({ theme: "teal", mode: "dark" });
  });
});

test.describe("TP-0b.4x: the system light", () => {
  test.use({ colorScheme: "light" });

  test("TP-0b.4x: with no cache the mode is light before first paint", async ({ page }) => {
    await recordBoot(page);

    await page.goto("/");

    expect((await boot(page)).body).toEqual({ theme: "teal", mode: "light" });
  });

  test("TP-0b.4x: a cached dark overrides the light system before first paint", async ({
    page,
  }) => {
    await cache(page, "dark");
    await recordBoot(page);

    await page.goto("/");

    expect((await boot(page)).body).toEqual({ theme: "teal", mode: "dark" });
  });
});

test("TP-0b.4x: index.html loads /theme-boot.js as the first child of <head>, a same-origin synchronous script", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  const html = await (await request.get("/")).text();
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";

  expect(head.trimStart().startsWith('<script src="/theme-boot.js"></script>')).toBe(true);
  // No inline script anywhere in the document (the CSP stays as it is).
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  const script = await request.get("/theme-boot.js");
  expect(script.status()).toBe(200);
  expect(script.headers()["content-type"] ?? "").toMatch(/javascript/);
});

test("TP-0b.4x: under the production CSP an inline script is reported, so the no-violation checks can fail", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await recordBoot(page);
  await page.goto("/");
  await boot(page);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__inlineRan = true;";
    document.head.append(s);
  });

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __boot: Boot }).__boot.csp.length))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as unknown as { __inlineRan?: boolean }).__inlineRan),
  ).toBeUndefined();
});
