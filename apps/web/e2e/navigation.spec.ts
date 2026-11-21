// Focus and announcements on navigation (F-216, F-218, A-333, A-336), and the 360 px layout. TP-11.15,
// TP-11.16, TP-11.38 (A-542: focus waits for the new page's heading), TP-11.39 (A-544: kept across a
// replaced heading), TP-11.40 (A-545: the h1 stays mounted while query regions load).
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

// ---- TP-11.39 (A-544): focus kept across a replaced heading ----

/**
 * Watches the page for TP-11.39: the first `main h1` and when it showed (`performance.now()`), and
 * every non-empty text written to `#live-polite`.
 */
async function watchHeadings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      tp1139: { first: Element | null; shownAt: number | null; announced: string[] };
    };
    w.tp1139 = { first: null, shownAt: null, announced: [] };
    const gallery = document.querySelector("main h1");
    new MutationObserver(() => {
      const h1 = document.querySelector("main h1");
      if (w.tp1139.first === null && h1 !== null && h1 !== gallery) {
        w.tp1139.first = h1;
        w.tp1139.shownAt = performance.now();
      }
    }).observe(document.body, { childList: true, subtree: true });
    const live = document.getElementById("live-polite");
    if (live !== null) {
      new MutationObserver(() => {
        const text = live.textContent;
        if (text !== "") w.tp1139.announced.push(text);
      }).observe(live, { childList: true, characterData: true, subtree: true });
    }
  });
}

/** Opens the gallery and clicks Replaced heading; waits until the first heading has been replaced. */
async function openReplacedHeading(page: Page): Promise<void> {
  await page.goto("/__fixtures/components");
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("[data-component]").first()).toBeVisible();
  await watchHeadings(page);

  await page.getByRole("link", { name: "Replaced heading" }).click();

  await expect(page).toHaveURL(/\/__fixtures\/slow-heading\?replace=1$/);
  await page.waitForFunction(() => {
    const w = window as unknown as { tp1139: { first: Element | null } };
    return w.tp1139.first !== null && !w.tp1139.first.isConnected;
  });
}

/** Waits until 1.2 s have passed since the first heading showed (past keepFocus's 1 s). */
async function pastKeepFocus(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { tp1139: { shownAt: number | null } };
    return w.tp1139.shownAt !== null && performance.now() - w.tp1139.shownAt > 1200;
  });
}

test("TP-11.39 (a) (A-544): Replaced heading: after the swap, focus is on the new 'Slow heading' element (the first is detached), and #live-polite received 'Slow heading' once", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  await openReplacedHeading(page);

  const h1 = page.locator("main h1");
  await expect(h1).toHaveText("Slow heading");
  await expect(h1).toBeFocused();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { tp1139: { first: Element | null } };
      return document.activeElement !== w.tp1139.first && document.activeElement?.isConnected;
    }),
  ).toBe(true);
  await pastKeepFocus(page);
  await expect(h1).toBeFocused();
  expect(
    await page.evaluate(
      () => (window as unknown as { tp1139: { announced: string[] } }).tp1139.announced,
    ),
  ).toEqual(["Slow heading"]);
});

test("TP-11.39 (b) (A-544): Replaced heading, then Tab once within 1 s of the heading first showing: focus stays where Tab put it", async ({
  page,
}, testInfo) => {
  // The fixture has nothing focusable after its h1, so Tab leaves the page and activeElement is
  // BODY; keepFocus must leave it there (the new heading isn't detached).
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await openReplacedHeading(page);
  await page.waitForFunction(() => {
    const h1 = document.querySelector("main h1");
    return h1 !== null && document.activeElement === h1;
  });
  await page.evaluate(() => {
    const w = window as unknown as { tp1139: { tabAt?: number } };
    addEventListener("keydown", () => {
      w.tp1139.tabAt ??= performance.now();
    });
  });

  await page.keyboard.press("Tab");

  const tabbed = await page.evaluate(() => {
    const w = window as unknown as {
      tp1139: { shownAt: number | null; tabAt?: number; tabbed?: Element | null };
    };
    w.tp1139.tabbed = document.activeElement;
    return {
      tag: document.activeElement?.tagName ?? null,
      within:
        w.tp1139.shownAt !== null &&
        w.tp1139.tabAt !== undefined &&
        w.tp1139.tabAt - w.tp1139.shownAt < 1000,
    };
  });
  expect(tabbed.within).toBe(true);
  expect(tabbed.tag).not.toBe("H1");
  await pastKeepFocus(page);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { tp1139: { tabbed?: Element | null } };
      return document.activeElement === w.tp1139.tabbed;
    }),
  ).toBe(true);
  await expect(page.locator("main h1")).not.toBeFocused();
});

test("TP-11.40 (A-545): Query heading: with both query regions resolved, at 500 ms the h1 first focused is still the same connected element, still focused, and never removed", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await page.goto("/__fixtures/components");
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("[data-component]").first()).toBeVisible();
  // Before the click: the first main h1 to take focus, and every removed node holding it.
  await page.evaluate(() => {
    const w = window as unknown as {
      tp1140: { start: number; focused: Element | null; removedIt: boolean; removed: Node[] };
    };
    w.tp1140 = { start: performance.now(), focused: null, removedIt: false, removed: [] };
    addEventListener(
      "focusin",
      (e) => {
        const h1 = document.querySelector("main h1");
        if (w.tp1140.focused === null && e.target === h1 && h1?.textContent === "Query heading") {
          w.tp1140.focused = h1;
        }
      },
      true,
    );
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.removedNodes) w.tp1140.removed.push(n);
      const it = w.tp1140.focused;
      if (it !== null && w.tp1140.removed.some((n) => n === it || n.contains(it))) {
        w.tp1140.removedIt = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByRole("link", { name: "Query heading" }).click();

  await expect(page).toHaveURL(/\/__fixtures\/query-heading$/);
  await page.waitForFunction(
    () => (window as unknown as { tp1140: { focused: Element | null } }).tp1140.focused !== null,
  );
  const main = page.locator("main");
  await expect(main.locator("h1")).toHaveText("Query heading");
  await expect(main.getByText("Loading…")).toHaveCount(0);
  await page.waitForFunction(
    () =>
      performance.now() - (window as unknown as { tp1140: { start: number } }).tp1140.start >= 500,
  );

  const at500 = await page.evaluate(() => {
    const w = window as unknown as {
      tp1140: { focused: Element | null; removedIt: boolean; removed: Node[] };
    };
    const it = w.tp1140.focused;
    return {
      same: it !== null && it === document.querySelector("main h1"),
      connected: it?.isConnected ?? false,
      focused: it !== null && document.activeElement === it,
      removedLater: it !== null && w.tp1140.removed.some((n) => n === it || n.contains(it)),
      removedIt: w.tp1140.removedIt,
    };
  });
  expect(at500).toEqual({
    same: true,
    connected: true,
    focused: true,
    removedLater: false,
    removedIt: false,
  });
});
