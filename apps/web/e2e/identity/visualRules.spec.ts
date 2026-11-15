// A-25's visual rules on S-1's screens (identity LLD S-1 "Visual style", guide §16). TP-1.40:
// light and dark here, pseudo-RTL through the pseudo-rtl project. Each screen: axe clean, the
// wordmark in the header, computed colours only from the token custom properties, nothing
// overflowing at 360 px; the join screen (S-5) has no primary button and the set-up screen (S-6)
// exactly one.
import AxeBuilder from "@axe-core/playwright";
import {
  catalogText,
  createInvitation,
  expect,
  openInvitation,
  signUpThroughUi,
  test,
  uniqueEmail,
  type Page,
} from "../identity.js";

/** Every --c-<token> colour the page defines, as the browser computes it. */
async function tokenColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const names: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        if (!(rule instanceof CSSStyleRule)) continue;
        for (const prop of [...rule.style]) if (prop.startsWith("--c-")) names.push(prop);
      }
    }
    const probe = document.createElement("div");
    document.body.append(probe);
    const out = [...new Set(names)].flatMap((n) => {
      const raw = style.getPropertyValue(n).trim();
      if (raw === "") return [];
      probe.style.color = raw;
      return [getComputedStyle(probe).color];
    });
    probe.remove();
    return out;
  });
}

/** Elements whose text, background or visible border colour isn't a token (transparent allowed). */
async function offTokenColours(page: Page): Promise<string[]> {
  const allowed = await tokenColours(page);
  return page.evaluate((tokens) => {
    const ok = new Set([...tokens, "rgba(0, 0, 0, 0)", "transparent"]);
    const bad: string[] = [];
    for (const el of [...document.querySelectorAll<HTMLElement>("body *")]) {
      if (el.closest("script, style, template, noscript")) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const checks: [string, string][] = [["background-color", s.backgroundColor]];
      if (el.textContent.trim() !== "") checks.push(["color", s.color]);
      if (Number.parseFloat(s.borderTopWidth) > 0) checks.push(["border-color", s.borderTopColor]);
      for (const [prop, value] of checks) {
        if (!ok.has(value)) bad.push(`${el.tagName.toLowerCase()} ${prop} ${value}`);
      }
    }
    return bad;
  }, allowed);
}

/** Buttons and button-links painted with the accent fill (a primary Button, guide §7.1). */
async function primaryCount(page: Page): Promise<number> {
  const accent = await accentRgb(page);
  return page
    .locator("main button, main a")
    .evaluateAll(
      (els, fill) => els.filter((el) => getComputedStyle(el).backgroundColor === fill).length,
      accent,
    );
}

async function expectCommonRules(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const wordmark = page.getByRole("banner").getByText("wDit", { exact: true });
  await expect(wordmark).toHaveCount(1);
  await expect(wordmark).toHaveAttribute("dir", "ltr");
  expect(await offTokenColours(page)).toEqual([]);
}

async function expectNoOverflowAt360(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const width = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
  expect(width).toBeLessThanOrEqual(360);
}

for (const mode of ["light", "dark"] as const) {
  test.describe(`TP-1.40: S-1's screens in ${mode} mode`, () => {
    test.use({ colorScheme: mode });

    test(`TP-1.40: sign-in (${mode})`, async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));

      await expectCommonRules(page);
      await expectNoOverflowAt360(page);
    });

    test(`TP-1.40: the invitation's join screen, S-5 (${mode}): no primary button`, async ({
      page,
      request,
    }) => {
      const { token } = await createInvitation(request, { email: uniqueEmail() });
      await openInvitation(page, token);

      await expectCommonRules(page);
      expect(await primaryCount(page)).toBe(0);
      await expectNoOverflowAt360(page);
    });

    test(`TP-1.40: the set-up screen, S-6 (${mode}): exactly one primary button`, async ({
      page,
      request,
    }) => {
      const { token } = await createInvitation(request, { email: uniqueEmail() });
      await openInvitation(page, token);
      await page.getByRole("button", { name: catalogText("Use a password") }).click();
      await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));

      await expectCommonRules(page);
      expect(await primaryCount(page)).toBe(1);
      await expect(page.getByRole("button", { name: catalogText("Create account") })).toHaveCSS(
        "background-color",
        await accentRgb(page),
      );
      await expectNoOverflowAt360(page);
    });

    test(`TP-1.40: an invitation problem, S-7 (${mode})`, async ({ page, request }) => {
      const { token } = await createInvitation(request, {
        email: uniqueEmail(),
        state: "revoked",
      });
      await page.goto(`/invite#t=${token}`);
      await expect(page.locator("main h1")).toHaveText(
        catalogText("This invitation can't be used"),
      );

      await expectCommonRules(page);
      await expectNoOverflowAt360(page);
    });

    test(`TP-1.40: the first-run home (${mode}): the header wordmark is a link home`, async ({
      page,
      request,
    }) => {
      const { token } = await createInvitation(request, { email: uniqueEmail() });
      await signUpThroughUi(page, token, "Visual Check");

      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
      const home = page.getByRole("banner").getByRole("link", { name: "wDit" });
      await expect(home).toHaveAttribute("href", "/");
      await expect(home).toHaveAttribute("dir", "ltr");
      expect(await offTokenColours(page)).toEqual([]);
      await expectNoOverflowAt360(page);
    });
  });
}

async function accentRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim();
    const probe = document.createElement("div");
    probe.style.color = raw;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });
}
