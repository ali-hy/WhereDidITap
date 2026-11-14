// P-A-513 (7), identity A-23 and A-26: the visible name "wDit". TP-0b.10. The favicon check waits
// for the guide's brand section (A-26), so it isn't here yet.
import { expect, test } from "./fixtures.js";

const APP = "wDit";

test("TP-0b.10: index.html's static <title> is wDit, before any script runs", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  const html = await (await request.get("/")).text();

  expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(APP);
});

test("TP-0b.10: signed out, the header's wordmark has the accessible name wDit and dir=ltr; page titles end with ' – wDit'", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  await page.goto("/");
  const wordmark = page.getByRole("banner").getByText(APP, { exact: true });

  await expect(wordmark).toHaveCount(1);
  await expect(wordmark).toHaveAttribute("dir", "ltr");
  await expect(page).toHaveTitle(APP);

  await page.evaluate(() => {
    history.pushState({}, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  });
  await expect(page).toHaveTitle(`Page not found – ${APP}`);

  await page.goto("/__fixtures/failing-loader");
  await expect(page).toHaveTitle(`Something went wrong on our side – ${APP}`);
  await expect(page.getByRole("banner").getByText(APP, { exact: true })).toHaveCount(1);
});
