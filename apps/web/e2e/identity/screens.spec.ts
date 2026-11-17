// S-3's cross-screen checks on identity's routes (identity LLD §8.1; HLD §4.4): TP-3.44
// (responsive), TP-3.45 (axe), TP-3.46 (pseudo-RTL, A-75), TP-3.53 (loading, error and list-size
// states, A-75), TP-3.54 (page titles). Later slices add their routes and screens. Extra cases end
// in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { randomUUID } from "node:crypto";
import { attachAxeReport } from "../fixtures.js";
import {
  catalogText,
  createInvitation,
  createUser,
  expect,
  looseText,
  openInvitation,
  signUpThroughUi,
  submitSignIn,
  test,
  uniqueEmail,
  type Page,
} from "../identity.js";

interface RouteCase {
  /** What the test opens. */
  path: string;
  /** The page's <h1> text (English; ar-XB adds only marks). */
  h1: string;
}

/** Identity's signed-out and unguarded routes in S-3. `/invite#t=` needs a fresh token. */
function signedOutRoutes(inviteToken: string): RouteCase[] {
  return [
    { path: "/sign-in", h1: "Sign in" },
    { path: "/privacy", h1: "Privacy notice" },
    // An empty #t= is the incomplete problem whatever is stored (A-62).
    { path: "/invite#t=", h1: "This invitation can't be used" },
    { path: `/invite#t=${inviteToken}`, h1: "You've been invited" },
  ];
}

/** Identity's signed-in routes in S-3, for a user named `name`. */
function signedInRoutes(name: string): RouteCase[] {
  return [
    { path: "/", h1: `Welcome, ${name}.` },
    { path: "/settings", h1: "Settings" },
    { path: "/settings/security", h1: "Sign-in & security" },
  ];
}

async function open(page: Page, route: RouteCase): Promise<void> {
  await page.goto(route.path);
  await expect(page.locator("main h1")).toHaveText(looseText(route.h1));
}

/** How far the page is wider than the viewport (≤ 0: no horizontal overflow). */
const overflow = (page: Page) =>
  page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth);

/** Whether the settings `nav` and the page's h1 sit side by side, nav at the inline start. */
async function settingsLayout(page: Page): Promise<"two columns" | "one column" | "other"> {
  const nav = await page.getByRole("navigation", { name: catalogText("Settings") }).boundingBox();
  const h1 = await page.locator("main h1").boundingBox();
  const rtl = (await page.locator("html").getAttribute("dir")) === "rtl";
  if (nav === null || h1 === null) return "other";
  const side = rtl ? nav.x >= h1.x + h1.width - 0.5 : nav.x + nav.width <= h1.x + 0.5;
  if (side) return "two columns";
  const stacked = nav.y + nav.height <= h1.y + 0.5 || h1.y + h1.height <= nav.y + 0.5;
  return stacked ? "one column" : "other";
}

const INTERNAL = {
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ defined: true, code: "INTERNAL", status: 500, message: "Internal error" }),
};

/** F-174 → P-F-203 for INTERNAL with operation "read" (`error.generic.read`; A-75 for sign-in). */
const INTERNAL_READ = "Something went wrong on our side. Try again in a moment.";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test.describe("TP-3.54: page titles (P-F-218, A-23)", () => {
  test("TP-3.54: every S-3 identity route's title is '<h1> – wDit' with no U+2066 to U+2069", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const { token } = await createInvitation(request, { email });
    const name = "Title Check";
    const check = async (route: RouteCase) => {
      await open(page, route);
      await expect
        .poll(async () => (await page.title()).replaceAll("‏", ""))
        .toBe(`${route.h1} – wDit`);
      expect(await page.title(), route.path).not.toMatch(/[⁦-⁩]/);
    };

    for (const route of signedOutRoutes(token)) await check(route);
    await signUpThroughUi(page, token, name);
    for (const route of signedInRoutes(name)) await check(route);
  });
});

test.describe("TP-3.44: responsive (360 px and 1280 px)", () => {
  test("TP-3.44: no horizontal overflow on the signed-out routes at 360 px and 1280 px", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of signedOutRoutes(token)) {
        await open(page, route);
        expect(await overflow(page), `${route.path} at ${String(width)} px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("TP-3.44: signed in, no horizontal overflow at 360 px and 1280 px; settings in two columns (nav at the inline start) at 1280 px and one column at 360 px", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    const name = "Responsive Check";
    await signUpThroughUi(page, token, name);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of signedInRoutes(name)) {
        await open(page, route);
        expect(await overflow(page), `${route.path} at ${String(width)} px`).toBeLessThanOrEqual(0);
        if (route.path.startsWith("/settings")) {
          expect(await settingsLayout(page), `${route.path} at ${String(width)} px`).toBe(
            width >= 960 ? "two columns" : "one column",
          );
        }
      }
    }
  });

  test("TP-3.44x: the settings layout switches at 960 px: one column at 959 px, two at 960 px", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, token, "Breakpoint Check");
    await page.setViewportSize({ width: 959, height: 800 });
    await open(page, { path: "/settings", h1: "Settings" });

    expect(await settingsLayout(page)).toBe("one column");

    await page.setViewportSize({ width: 960, height: 800 });

    await expect.poll(() => settingsLayout(page)).toBe("two columns");
  });
});

test.describe("TP-3.45: axe on identity's routes", () => {
  test("TP-3.45: an axe report is attached for every S-3 identity route (never failing)", async ({
    page,
    request,
  }, testInfo) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    const name = "Axe Check";
    const scan = async (route: RouteCase) => {
      await open(page, route);
      expect(await attachAxeReport(page, testInfo), route.path).not.toBeNull();
    };

    for (const route of signedOutRoutes(token)) await scan(route);
    await signUpThroughUi(page, token, name);
    for (const route of signedInRoutes(name)) await scan(route);

    const reports = testInfo.attachments.filter((a) => a.name === "axe-report.json");
    expect(reports.length).toBeGreaterThanOrEqual(7);
  });
});

test.describe("TP-3.46: pseudo-RTL (ar-XB; A-75)", () => {
  /** The text of `selector`'s first match ends at its parent's content-box right edge. */
  async function textAtRight(page: Page, selector: string): Promise<number> {
    return page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const parent = el.parentElement ?? el;
        const box = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        const right =
          box.right -
          Number.parseFloat(style.paddingRight) -
          Number.parseFloat(style.borderRightWidth);
        return Math.abs(text.right - right);
      });
  }

  const direction = (el: ReturnType<Page["locator"]>) =>
    el.evaluate((node) => getComputedStyle(node).direction);

  /**
   * For each `[data-button-row]`: its visible buttons, and how far the first one (DOM order) is
   * from being the rightmost (≤ 1: it is).
   */
  const buttonRows = (page: Page): Promise<{ buttons: number; offBy: number }[]> =>
    page.locator("[data-button-row]").evaluateAll((rows) =>
      rows.map((row) => {
        const rights = Array.from(row.querySelectorAll("button, a[href]"))
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => r.right);
        const first = rights[0] ?? 0;
        return { buttons: rights.length, offBy: Math.max(0, ...rights) - first };
      }),
    );

  /** `dir`, the h1 at the right, every button row first-rightmost, and no horizontal overflow. */
  async function expectRtlRules(page: Page): Promise<void> {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await textAtRight(page, "main h1")).toBeLessThanOrEqual(1);
    for (const row of await buttonRows(page)) {
      expect(row.buttons).toBeGreaterThan(0);
      expect(row.offBy).toBeLessThanOrEqual(1);
    }
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
  }

  const PSEUDO_ONLY = "pseudo-rtl project only";

  test("TP-3.46: S-1 Sign in: dir=rtl, the h1 at the right, the form's button row first-rightmost, the email field LTR, no overflow", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "pseudo-rtl", PSEUDO_ONLY);
    await page.goto("/sign-in");
    await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));
    await expect(page.getByLabel(catalogText("Email"))).toBeVisible();

    // The sign-in form's row of buttons carries the marker (A-75).
    await expect(page.locator("main form [data-button-row]")).not.toHaveCount(0);
    await expectRtlRules(page);
    expect(await direction(page.getByLabel(catalogText("Email")))).toBe("ltr");
  });

  test("TP-3.46: S-6 Set up your account: dir=rtl, the h1 at the right, the form's button row first-rightmost, the invited email LTR, no overflow", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "pseudo-rtl", PSEUDO_ONLY);
    const email = uniqueEmail();
    const { token } = await createInvitation(request, { email });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));

    await expect(page.locator("main form [data-button-row]")).not.toHaveCount(0);
    await expectRtlRules(page);
    const shown = page.locator("main").getByText(email, { exact: true }).first();
    expect(await direction(shown)).toBe("ltr");
  });

  test("TP-3.46: S-10 Sign-in & security for an ar-XB user with a second session: dir=rtl, the h1 at the right, every button row first-rightmost, no overflow", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "pseudo-rtl", PSEUDO_ONLY);
    // createUser's accept already makes one session; the browser's sign-in is the second.
    const { email } = await createUser(request, { locale: "ar-XB", name: "RTL Person" });
    await submitSignIn(page, email);
    await expect(page).toHaveURL(/\/$/);

    await open(page, { path: "/settings/security", h1: "Sign-in & security" });
    const signOutOthers = page
      .locator("main")
      .getByRole("button", { name: catalogText("Sign out of all other devices") });
    await expect(signOutOthers).toBeVisible();

    // A-77: only Sign out of all other devices sits in a button row; a session row's Sign out doesn't.
    await expect(
      page.locator("main [data-button-row]").getByRole("button", {
        name: catalogText("Sign out of all other devices"),
      }),
    ).toHaveCount(1);
    const rowSignOut = page.locator("main").getByRole("button", { name: catalogText("Sign out") });
    await expect(rowSignOut).toHaveCount(1);
    expect(await rowSignOut.evaluate((b) => b.closest("[data-button-row]") === null)).toBe(true);

    await expectRtlRules(page);
  });
});

test.describe("TP-3.53: loading, error and list-size states (HLD §4.4; A-75)", () => {
  test("TP-3.53: S-1 Sign in: while auth.signIn is pending, Sign in is busy and the fields read-only; INTERNAL then shows the form-level 'Something went wrong on our side. Try again in a moment.' and the form is usable again", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);
    const gate = deferred();
    await page.route("**/api/v1/auth/sign-in", async (route) => {
      await gate.promise;
      await route.fulfill(INTERNAL);
    });

    await submitSignIn(page, email);

    const submit = page.locator("main").getByRole("button", { name: catalogText("Sign in") });
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(catalogText("Email"))).not.toBeEditable();
    await expect(page.getByLabel(catalogText("Password"))).not.toBeEditable();
    gate.resolve();

    await expect(page.locator("main").getByText(catalogText(INTERNAL_READ))).toBeVisible();
    await expect(submit).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(catalogText("Email"))).toBeEditable();
    expect(new URL(page.url()).pathname).toBe("/sign-in");
  });

  test("TP-3.53: S-10 sessions: while me.listSessions is pending, a busy section with skeleton rows; INTERNAL → 'Something went wrong on our side. Try again in a moment.' with Try again, which then lists this device", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, token, "Sessions States");
    const gate = deferred();
    let calls = 0;
    await page.route("**/api/v1/me/sessions", async (route) => {
      calls += 1;
      if (calls > 1) {
        await route.continue();
        return;
      }
      await gate.promise;
      await route.fulfill(INTERNAL);
    });

    await page.goto("/settings/security");

    await expect(page.locator("main h1")).toHaveText(catalogText("Sign-in & security"));
    const busy = page.locator('main [aria-busy="true"]').first();
    await expect(busy).toBeAttached();
    // P-A-515 (c): the Skeleton's aria-hidden blocks, shown after 300 ms.
    await expect(busy.locator('[aria-hidden="true"]:has(> div)').first()).toBeVisible();
    gate.resolve();
    await expect(page.locator("main").getByText(catalogText(INTERNAL_READ))).toBeVisible();
    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Try again") })
      .click();
    await expect(page.locator("main").getByText(catalogText("This device"))).toHaveCount(1);
    expect(calls).toBe(2);
  });

  test("TP-3.53: S-10 sessions with one session (this device): that row, no per-row Sign out and no Sign out of all other devices", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, token, "One Session");
    const listed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/sessions");

    await page.goto("/settings/security");

    const answer = await listed;
    expect(answer.status()).toBe(200);
    expect(((await answer.json()) as { items: unknown[] }).items).toHaveLength(1);
    const main = page.locator("main");
    await expect(main.getByText(catalogText("This device"))).toHaveCount(1);
    await expect(main.getByRole("button", { name: catalogText("Sign out") })).toHaveCount(0);
    await expect(
      main.getByRole("button", { name: catalogText("Sign out of all other devices") }),
    ).toHaveCount(0);
  });

  test("TP-3.53: S-10 sessions with 20 items (§3.3's maximum) at 360 px: all listed, this device first (19 Sign out buttons after it), without horizontal overflow", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, token, "Many Sessions");
    const labels = [
      "Chrome on Windows",
      "Android · Pixel 8",
      "Firefox on macOS",
      "A browser on an unknown system with a very long description that has to wrap",
    ];
    const start = Date.parse("2026-11-01T10:00:00.000Z");
    // As F-54 sends them: the current session first, then by lastUsedAt descending.
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      deviceLabel: labels[i % labels.length],
      clientKind: i % 2 === 0 ? "web" : "android",
      createdAt: new Date(start - i * 3_600_000).toISOString(),
      lastUsedAt: new Date(start + (20 - i) * 60_000).toISOString(),
      current: i === 0,
    }));
    await page.route("**/api/v1/me/sessions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items }),
      }),
    );
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto("/settings/security");

    const main = page.locator("main");
    const perRow = main.getByRole("button", { name: catalogText("Sign out") });
    await expect(perRow).toHaveCount(19);
    const thisDevice = main.getByText(catalogText("This device"));
    await expect(thisDevice).toHaveCount(1);
    const thisDeviceFirst = await thisDevice.evaluate(
      (el, first) => Boolean(el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
      await perRow.first().elementHandle(),
    );
    expect(thisDeviceFirst).toBe(true);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
