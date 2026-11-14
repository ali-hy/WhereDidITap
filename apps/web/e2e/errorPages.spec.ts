// P-A-513 (5) the error and not-found pages (guide §7.1, §9.3; closes P-FU-1). TP-0b.7. The
// behaviour of the fallback (focus, live text, the reference line) stays TP-11.7 and TP-11.8's.
import { catalogText, expect, test, type Locator, type Page } from "./fixtures.js";

// The refresh icon's path data (F-215 registry, "refresh").
const REFRESH_PATH = "M21 3v5h-5";

/** A token's colour as the browser computes it (rgb()), from guide §14's --c-<token> variables. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--c-${n}`).trim();
    if (raw === "") throw new Error(`--c-${n} is not defined`);
    const probe = document.createElement("div");
    probe.style.color = raw;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, name);
}

const style = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      background: s.backgroundColor,
      color: s.color,
      borderColor: s.borderTopColor,
      borderWidth: s.borderTopWidth,
    };
  });

/** Guide §7.1 primary: accent fill, on-accent text. */
async function expectPrimary(page: Page, l: Locator): Promise<void> {
  const s = await style(l);
  expect(s.background).toBe(await token(page, "accent"));
  expect(s.color).toBe(await token(page, "on-accent"));
}

/** Guide §7.1 secondary: surface fill, 1 px line-strong border, fg text. */
async function expectSecondary(page: Page, l: Locator): Promise<void> {
  const s = await style(l);
  expect(s.background).toBe(await token(page, "surface"));
  expect(s.color).toBe(await token(page, "fg"));
  expect(s.borderColor).toBe(await token(page, "line-strong"));
  expect(s.borderWidth).toBe("1px");
}

test("TP-0b.7: the error page's Try again is the primary button with the refresh icon, Go to home a secondary link to /; after a failed retry they stay so", async ({
  page,
}) => {
  await page.goto("/__fixtures/failing-loader");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(
    catalogText("Something went wrong on our side"),
  );
  const retry = main.getByRole("button", { name: /Try again/ });
  const home = main.getByRole("link", { name: catalogText("Go to home") });

  await expectPrimary(page, retry);
  await expect(retry.locator(`svg path[d="${REFRESH_PATH}"]`)).toHaveCount(1);
  expect(await home.evaluate((el) => el.tagName)).toBe("A");
  await expect(home).toHaveAttribute("href", "/");
  await expectSecondary(page, home);

  await retry.click();
  await expect(main.getByRole("status")).toHaveText(catalogText("Still not working."));
  // Off the button, so guide §7.3's hover colour doesn't stand in for the resting one.
  await page.mouse.move(0, 0);

  await expectPrimary(page, retry);
  await expect(retry.locator(`svg path[d="${REFRESH_PATH}"]`)).toHaveCount(1);
  await expectSecondary(page, home);
});

test("TP-0b.7: on the not-found page Go to home is the primary action, and there is no Try again", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    history.pushState({}, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  });
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(catalogText("Page not found"));
  const home = main.getByRole("link", { name: catalogText("Go to home") });

  await expect(home).toHaveAttribute("href", "/");
  await expectPrimary(page, home);
  await expect(main.getByRole("button", { name: /Try again/ })).toHaveCount(0);
});

test("TP-0b.7: a full load of /no-such-page shows the same not-found page", async ({ page }) => {
  await page.goto("/no-such-page");
  const main = page.locator("main");

  await expect(main.getByRole("heading", { level: 1 })).toHaveText(catalogText("Page not found"));
  await expectPrimary(page, main.getByRole("link", { name: catalogText("Go to home") }));
});
