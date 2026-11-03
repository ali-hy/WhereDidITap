// Per-page document titles (F-218 setDocumentTitle, F-216 pages, F-209; A-464). TP-11.33.
import { expect, test } from "./fixtures.js";

test("TP-11.33 (A-464): / is Budmon; a client-side Page not found is Page not found – Budmon; the error fallback is Something went wrong on our side – Budmon", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  await page.goto("/");
  await expect(page).toHaveTitle("Budmon");

  await page.evaluate(() => {
    history.pushState({}, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  });
  await expect(page).toHaveTitle("Page not found – Budmon");

  await page.goto("/__fixtures/failing-loader");
  await expect(page).toHaveTitle("Something went wrong on our side – Budmon");
});
