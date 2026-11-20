// Focus and announcements on navigation (F-216, F-218, A-333, A-336), and the 360 px layout. TP-11.15,
// TP-11.16, TP-11.38 (A-542: focus waits for the new page's heading).
import { catalogText, expect, test, type Page } from "./fixtures.js";

async function expectFocusedHeading(page: Page, text: string): Promise<void> {
  const h1 = page.locator("main h1");
  await expect(h1).toHaveText(catalogText(text));
  await expect(h1).toBeFocused();
  await expect(h1).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#live-polite")).toHaveText(catalogText(text));
}

/** A client-side navigation through the router's history (no page load). */
async function navigate(page: Page, to: string): Promise<void> {
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  }, to);
}

// A-510: the platform's placeholder lives at /__fixtures/home-placeholder once a module takes /.
const PLACEHOLDER = "/__fixtures/home-placeholder";

test("TP-11.15 (A-333, A-510): on load focus stays on body and #live-polite is empty; navigating to an unknown path and back home focuses each h1 and announces its text", async ({
  page,
}) => {
  await page.goto(PLACEHOLDER);
  await expect(page.locator("main h1")).toHaveText(catalogText("wDit"));
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
  await expect(page.locator("body")).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");

  await navigate(page, "/no-such-page");
  await expectFocusedHeading(page, "Page not found");

  await page.getByRole("link", { name: "Go to home" }).click();
  // Whatever page / resolves to after redirects (signed out: the sign-in page).
  await expect(page).not.toHaveURL(/\/no-such-page$/);
  const h1 = page.locator("main h1");
  await expect(h1).toBeFocused();
  await expect(h1).toHaveAttribute("tabindex", "-1");
  const text = (await h1.textContent()) ?? "";
  expect(text.trim()).not.toBe("");
  await expect(page.locator("#live-polite")).toHaveText(text);
});

// A-402 (a): only a pathname change moves focus and announces.
test("TP-11.15 (A-402, A-510): a search-only change on the placeholder leaves focus and #live-polite alone", async ({
  page,
}) => {
  await page.goto(PLACEHOLDER);
  await expect(page.locator("main h1")).toHaveText(catalogText("wDit"));
  // A state where a wrongly fired focus move or announcement would show.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const region = document.getElementById("live-polite");
    if (region !== null) region.textContent = "";
  });

  await navigate(page, `${PLACEHOLDER}?q=tp-11-15`);
  await expect(page).toHaveURL(/\/__fixtures\/home-placeholder\?q=tp-11-15$/);
  // A negative check: give a focus move or announcement time to happen.
  await page.waitForTimeout(1_000);

  await expect(page.locator("body")).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");
});

// A-402 (b), through A-416's fixture: router.invalidate() re-runs the loader without moving focus
// or announcing.
test("TP-11.15 (A-402, A-416): router.invalidate() re-runs the loader; focus stays on the button and #live-polite stays empty", async ({
  page,
}) => {
  await page.goto("/__fixtures/invalidate");
  const runs = page.getByTestId("loader-runs");
  await expect(runs).toHaveText("Loader runs: 1");
  const button = page.getByRole("button", { name: "Invalidate" });
  for (let i = 0; i < 10 && !(await button.evaluate((b) => b === document.activeElement)); i += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");

  await page.keyboard.press("Enter");

  await expect(runs).toHaveText("Loader runs: 2");
  // A negative check: give a focus move or announcement time to happen.
  await page.waitForTimeout(1_000);
  await expect(button).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");
});

test.describe("TP-11.16: 360 px layout", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ["/", "/this-page-does-not-exist", "/__fixtures/rtl-probe"]) {
    test(`TP-11.16: ${route} doesn't overflow horizontally at 360×740`, async ({ page }) => {
      await page.goto(route);
      await page.locator("main h1").first().waitFor();

      const width = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);

      expect(width).toBeLessThanOrEqual(360);
    });
  }
});

test("TP-11.38 (A-542): the components gallery's Slow heading link: once the 300 ms resource resolves, focus is on 'Slow heading' (not BODY, not the gallery's h1) and it's announced", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await page.goto("/__fixtures/components");
  const h1 = page.locator("main h1");
  await expect(h1).toHaveCount(1);
  await expect(page.locator("[data-component]").first()).toBeVisible();
  const galleryHeading = (await h1.textContent()) ?? "";

  await page.getByRole("link", { name: "Slow heading" }).click();

  await expect(page).toHaveURL(/\/__fixtures\/slow-heading$/);
  await expect(h1).toHaveText("Slow heading");
  await expect(h1).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
  expect(galleryHeading).not.toBe("Slow heading");
  await expect(page.locator("#live-polite")).toHaveText("Slow heading");
});
