// P-A-522, identity A-32: the base link style (guide §8.6). TP-0b.11. /__fixtures/rtl-probe has a
// FormErrorSummary entry with a link and the error fallback's "Go to home", a secondary Button href.
import { catalogText, expect, test, type Locator, type Page } from "./fixtures.js";

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

const decoration = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      line: s.textDecorationLine,
      thickness: s.textDecorationThickness,
      offset: s.textUnderlineOffset,
      color: s.color,
      background: s.backgroundColor,
      borderColor: s.borderTopColor,
    };
  });

async function open(page: Page): Promise<{ summaryLink: Locator; buttonLink: Locator }> {
  await page.goto("/__fixtures/rtl-probe");
  const summaryLink = page.getByRole("link", { name: "Some details need fixing." });
  const buttonLink = page.getByRole("link", { name: catalogText("Go to home") });
  await expect(summaryLink).toBeVisible();
  await expect(buttonLink).toBeVisible();
  await page.mouse.move(0, 0);
  return { summaryLink, buttonLink };
}

for (const mode of ["light", "dark"] as const) {
  test.describe(`TP-0b.11: ${mode} mode`, () => {
    test.use({ colorScheme: mode });

    test(`TP-0b.11: in ${mode} mode the summary link is accent-fg, underlined 1 px at a 2 px offset, and 2 px thick on hover`, async ({
      page,
    }) => {
      const { summaryLink } = await open(page);
      const accentFg = await token(page, "accent-fg");

      const rest = await decoration(summaryLink);
      expect(rest.line).toBe("underline");
      expect(rest.thickness).toBe("1px");
      expect(rest.offset).toBe("2px");
      expect(rest.color).toBe(accentFg);

      await summaryLink.hover();
      await expect.poll(async () => (await decoration(summaryLink)).thickness).toBe("2px");
      const hovered = await decoration(summaryLink);
      expect(hovered.line).toBe("underline");
      expect(hovered.offset).toBe("2px");
      expect(hovered.color).toBe(accentFg);
    });

    test(`TP-0b.11: in ${mode} mode the Button link has no underline, at rest or hovered, and the secondary variant's colours`, async ({
      page,
    }) => {
      const { buttonLink } = await open(page);

      const rest = await decoration(buttonLink);
      expect(rest.line).toBe("none");
      expect(rest.color).toBe(await token(page, "fg"));
      expect(rest.background).toBe(await token(page, "surface"));
      expect(rest.borderColor).toBe(await token(page, "line-strong"));

      await buttonLink.hover();
      expect((await decoration(buttonLink)).line).toBe("none");
    });
  });
}
