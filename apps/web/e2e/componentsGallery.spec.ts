// Platform A-527: the fixtures-only component gallery /__fixtures/components. Identity TP-1.43
// (built in identity S-1): axe (colour contrast included) in light and dark, and in pseudo-RTL
// through the pseudo-rtl project; every component's section; a 2 px focus outline on every
// control; borders and a Highlight focus outline in forced colours. The route's absence from a
// production build is TP-11.27's check (no built file contains "__fixtures").
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures.js";

const COMPONENTS = [
  "Button",
  "TextField",
  "PasswordField",
  "CodeField",
  "ComboboxField",
  "RadioGroupField",
  "EmptyState",
  "Skeleton",
  "Wordmark",
  "SignedOutColumn",
];

async function openGallery(page: Page): Promise<void> {
  await page.goto("/__fixtures/components");
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("[data-component]").first()).toBeVisible();
}

/** Tabs through the page; returns each focused control's outline, until focus cycles. */
async function tabThrough(
  page: Page,
): Promise<{ what: string; width: string; style: string; color: string }[]> {
  await page.locator("body").focus();
  const seen: { what: string; width: string; style: string; color: string }[] = [];
  const visited = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el === document.body) return null;
      const s = getComputedStyle(el);
      const path: string[] = [];
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        path.push(`${n.tagName}:${String([...(n.parentElement?.children ?? [])].indexOf(n))}`);
      }
      return {
        key: path.join("/"),
        what: `${el.tagName.toLowerCase()}${el.id === "" ? "" : `#${el.id}`} ${el.textContent.trim().slice(0, 30)}`,
        width: s.outlineWidth,
        style: s.outlineStyle,
        color: s.outlineColor,
      };
    });
    if (current === null || visited.has(current.key)) break;
    visited.add(current.key);
    seen.push({
      what: current.what,
      width: current.width,
      style: current.style,
      color: current.color,
    });
  }
  return seen;
}

for (const mode of ["light", "dark"] as const) {
  test.describe(`TP-1.43: the gallery in ${mode} mode`, () => {
    test.use({ colorScheme: mode });

    test(`TP-1.43: axe (with color-contrast) finds no violation in ${mode} mode`, async ({
      page,
    }) => {
      await openGallery(page);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
      expect(
        [...results.passes, ...results.incomplete, ...results.inapplicable].some(
          (r) => r.id === "color-contrast",
        ),
      ).toBe(true);
    });

    test(`TP-1.43: every component section is present, and each focused control shows a 2 px outline (${mode})`, async ({
      page,
    }) => {
      await openGallery(page);

      const names = await page
        .locator("section[data-component]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-component")));
      expect(names).toEqual(expect.arrayContaining(COMPONENTS));
      for (const name of COMPONENTS) {
        await expect(page.locator(`section[data-component="${name}"] h2`)).toHaveCount(1);
      }
      const focused = await tabThrough(page);
      expect(focused.length).toBeGreaterThan(10);
      expect(focused.filter((f) => f.width !== "2px" || f.style === "none")).toEqual([]);
    });
  });
}

test.describe("TP-1.43: forced colours", () => {
  test.use({ forcedColors: "active" });

  test("TP-1.43: every button, field, combobox and radio has a visible border, and the focus outline is Highlight", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "one forced-colours run (chromium)");
    await openGallery(page);

    const borderless = await page
      .locator(
        'main button, main input:not([type="hidden"]), main [role="combobox"], main [role="radio"], main textarea, main select',
      )
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return false;
            const bordered = (e: Element) => {
              const st = getComputedStyle(e);
              return st.borderTopStyle !== "none" && Number.parseFloat(st.borderTopWidth) >= 1;
            };
            // A visually hidden native input (a radio drawn by its own control) passes when a
            // bordered element is drawn next to it, inside the same item.
            const box = el.getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) {
              const item = el.closest("label") ?? el.parentElement;
              return (
                item === null ||
                ![...item.querySelectorAll("*")].some((e) => e !== el && bordered(e))
              );
            }
            return !bordered(el);
          })
          .map((el) => `${el.tagName.toLowerCase()} ${el.textContent.trim().slice(0, 30)}`),
      );
    expect(borderless).toEqual([]);

    const highlight = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "Highlight";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    const focused = await tabThrough(page);
    expect(focused.length).toBeGreaterThan(10);
    expect(focused.filter((f) => f.color !== highlight || f.style === "none")).toEqual([]);
  });
});
