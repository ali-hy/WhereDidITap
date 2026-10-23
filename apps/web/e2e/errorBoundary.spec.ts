// The router's error boundary (F-216, §8.1 S-2). TP-11.8 on /__fixtures/flaky-loader (A-328), whose
// loader throws on its first run after a page load and then renders <h1> "Recovered".
import { catalogText, expect, test } from "./fixtures.js";

test("TP-11.8: a loader that throws shows the error fallback; Try again re-runs the loader and shows Recovered", async ({
  page,
}) => {
  await page.goto("/__fixtures/flaky-loader");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    catalogText("Something went wrong on our side"),
  );
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recovered");
  await expect(page.getByText("Something went wrong on our side")).toHaveCount(0);
});

// A-397: /__fixtures/failing-loader's loader always throws. The root layout keeps the failed retry
// (the router remounts the error component), so each retry ends in "Still not working.".
test("TP-11.8 (b): on a loader that keeps failing, each Try again keeps the fallback, shows Still not working. and re-enables the button", async ({
  page,
}) => {
  await page.goto("/__fixtures/failing-loader");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(catalogText("Something went wrong on our side"));
  const fallback = page.locator("section").filter({ has: heading });
  // A-400: the status element is there, empty, before any retry.
  await expect(fallback.getByRole("status")).toHaveText("");

  for (let click = 1; click <= 2; click += 1) {
    const button = page.getByRole("button", { name: "Try again" });
    await button.click();

    await expect(fallback.getByRole("status")).toHaveText(catalogText("Still not working."));
    await expect(heading).toHaveText(catalogText("Something went wrong on our side"));
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  }
});

/** Tabs until the fallback's Try again button has focus (at most 15 presses). */
async function tabToRetry(page: import("./fixtures.js").Page): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    const onRetry = await page.evaluate(
      () => document.activeElement?.hasAttribute("data-fallback-retry") ?? false,
    );
    if (onRetry) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached Try again");
}

// A-456: keyboard only; focus lands on the new h1 (and it's announced) or stays on Try again.
test("TP-11.8 (A-456) (a): keyboard only on flaky-loader: Tab to Try again, Enter; focus moves to h1 Recovered, announced in #live-polite", async ({
  page,
}) => {
  await page.goto("/__fixtures/flaky-loader");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    catalogText("Something went wrong on our side"),
  );

  await tabToRetry(page);
  await page.keyboard.press("Enter");

  const h1 = page.locator("main h1");
  await expect(h1).toHaveText("Recovered");
  await expect(h1).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("Recovered");
});

test("TP-11.8 (A-456) (b): keyboard only on failing-loader: after each failing retry focus is on main [data-fallback-retry], never body", async ({
  page,
}) => {
  await page.goto("/__fixtures/failing-loader");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(catalogText("Something went wrong on our side"));
  const retry = page.locator("main [data-fallback-retry]");

  await tabToRetry(page);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.keyboard.press("Enter");
    await expect(page.locator("section").filter({ has: heading }).getByRole("status")).toHaveText(
      catalogText("Still not working."),
    );
    await expect(retry).toBeEnabled();
    await expect(retry).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  }
});
