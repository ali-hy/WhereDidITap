// Per-page document titles (F-218 setDocumentTitle, F-216 pages, F-209; A-464). TP-11.33.
import { expect, test } from "./fixtures.js";

test("TP-11.33 (A-464, A-510): the home placeholder is wDit; a client-side Page not found is Page not found – wDit; the error fallback is Something went wrong on our side – wDit", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  await page.goto("/__fixtures/home-placeholder");
  await expect(page).toHaveTitle("wDit");

  await page.evaluate(() => {
    history.pushState({}, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  });
  await expect(page).toHaveTitle("Page not found – wDit");

  await page.goto("/__fixtures/failing-loader");
  await expect(page).toHaveTitle("Something went wrong on our side – wDit");
});
