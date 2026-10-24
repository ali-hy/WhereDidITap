// The Kobalte spike (DV-3, AC-11.4) on /__fixtures/kobalte-spike (§8.1, A-331): keyboard only.
// TP-11.28.
import { expect, test, type Locator, type Page } from "./fixtures.js";

async function expectFocusVisible(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false),
  ).toBe(true);
}

/** Tabs until `target` is focused (at most 40 presses), then checks the focus indicator. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expectFocusVisible(page);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the target");
}

test.beforeEach(async ({ page }, testInfo) => {
  // A-337: chromium only (en-US, UTC), so the native date input's segment order is known.
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await page.goto("/__fixtures/kobalte-spike");
});

test('TP-11.28: "Open dialog" opens "Spike dialog"; Escape and "Close" both close it, returning focus to the trigger', async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Open dialog" });
  const dialog = page.getByRole("dialog", { name: "Spike dialog" });

  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectFocusVisible(page);

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "Close" }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('TP-11.28: the "Currency" combobox: type EG, ArrowDown, Enter gives EGP', async ({ page }) => {
  const combobox = page.getByRole("combobox", { name: "Currency" });

  await tabTo(page, combobox);
  await page.keyboard.type("EG");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(combobox).toHaveValue("EGP");
});

test('TP-11.28: the "Date" field takes 2026-10-07 from the keyboard', async ({ page }) => {
  const date = page.getByLabel("Date");

  await tabTo(page, date);
  // A native date input takes its segments in the locale's order; chromium runs en-US (A-337):
  // month, day, year.
  await page.keyboard.type("10072026");

  await expect(date).toHaveValue("2026-10-07");
});

test('TP-11.28: "Actions" opens with Enter; ArrowDown to Delete and Enter sets "Picked: Delete"', async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Actions" });

  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    const focused = await page.evaluate(() => document.activeElement?.textContent.trim() ?? "");
    if (focused === "Delete") break;
    await page.keyboard.press("ArrowDown");
    await expectFocusVisible(page);
  }
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(menu).toBeHidden();
  // A-373: other status regions (the offline banner's) are always mounted, so find this one by text.
  await expect(page.getByRole("status").filter({ hasText: "Picked:" })).toHaveText(
    "Picked: Delete",
  );
});
