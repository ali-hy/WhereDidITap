// P-A-513 (8): axe on the platform's pages in light and dark mode (guide §12.3, D-39). TP-0b.8.
// Unlike the report-only withAxe fixture (TP-11.14), these pages must have no violation.
import AxeBuilder from "@axe-core/playwright";
import { attachAxeReport, catalogText, expect, test, type Page } from "./fixtures.js";

/** The platform's own pages; the planted a11y-violation fixture (A-332) is excluded. */
const PAGES: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "home",
    open: async (page) => {
      await page.goto("/");
      await expect(page.locator("main h1")).toBeVisible();
    },
  },
  {
    name: "not found",
    open: async (page) => {
      await page.goto("/no-such-page");
      await expect(page.locator("main h1")).toHaveText(catalogText("Page not found"));
    },
  },
  {
    name: "error fallback",
    open: async (page) => {
      await page.goto("/__fixtures/failing-loader");
      await expect(page.locator("main h1")).toHaveText(
        catalogText("Something went wrong on our side"),
      );
    },
  },
  {
    name: "error fallback after a failed retry",
    open: async (page) => {
      await page.goto("/__fixtures/failing-loader");
      await page.getByRole("button", { name: /Try again/ }).click();
      await expect(page.locator("main").getByRole("status")).toHaveText(
        catalogText("Still not working."),
      );
    },
  },
];

for (const mode of ["light", "dark"] as const) {
  test.describe(`TP-0b.8: ${mode} mode`, () => {
    test.use({ colorScheme: mode });

    for (const p of PAGES) {
      test(`TP-0b.8: ${p.name} in ${mode} mode has no axe violation`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "chromium project only");

        await p.open(page);
        await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
        const results = await new AxeBuilder({ page }).analyze();
        await attachAxeReport(page, testInfo);

        expect(results.violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
      });
    }
  });
}
