// Focus and announcements on navigation (F-216, F-218, A-333, A-336), and the 360 px layout. TP-11.15,
// TP-11.16.
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

test("TP-11.15 (A-333): on load focus stays on body and #live-polite is empty; navigating to an unknown path and back to / focuses each h1 and announces its text", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText(catalogText("Budmon"));
  await expect(page.locator("body")).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");

  await navigate(page, "/no-such-page");
  await expectFocusedHeading(page, "Page not found");

  await page.getByRole("link", { name: "Go to home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectFocusedHeading(page, "Budmon");
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
});

// A-402: only a pathname change moves focus and announces.
test("TP-11.15 (A-402): a search-only change on / leaves focus and #live-polite alone", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText(catalogText("Budmon"));
  // A state where a wrongly fired focus move or announcement would show.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const region = document.getElementById("live-polite");
    if (region !== null) region.textContent = "";
  });

  await navigate(page, "/?q=tp-11-15");
  await expect(page).toHaveURL(/\/\?q=tp-11-15$/);
  // A negative check: give a focus move or announcement time to happen.
  await page.waitForTimeout(1_000);

  await expect(page.locator("body")).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");
});

// A-402's second half needs the router: nothing outside the app can call router.invalidate() on /
// (question raised: a test seam, such as a fixture control that calls it).
test.fixme("TP-11.15 (A-402): router.invalidate() on / leaves focus and #live-polite alone", () => {
  // Awaiting a way to call router.invalidate() from the page.
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
