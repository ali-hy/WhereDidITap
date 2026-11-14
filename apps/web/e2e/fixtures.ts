// Playwright fixtures (§10.1, D-39; test-architect). Every spec imports `test` and `expect` from
// here, so the automatic `withAxe` fixture runs axe after each test and attaches the JSON report.
// The report never fails a test.
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";

export interface AxeReport {
  url: string;
  violations: { id: string; impact?: string | null | undefined; nodes: unknown[] }[];
}

/** Runs axe on `page` and attaches the report as `axe-report.json`; never throws. */
export async function attachAxeReport(page: Page, testInfo: TestInfo): Promise<AxeReport | null> {
  try {
    const results = await new AxeBuilder({ page }).analyze();
    const report: AxeReport = {
      url: page.url(),
      violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes })),
    };
    await testInfo.attach("axe-report.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    return report;
  } catch (err) {
    await testInfo.attach("axe-report-error.txt", {
      body: err instanceof Error ? err.message : String(err),
      contentType: "text/plain",
    });
    return null;
  }
}

export const test = base.extend<{ withAxe: undefined }>({
  withAxe: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (page.url() !== "about:blank") await attachAxeReport(page, testInfo);
    },
    { auto: true },
  ],
});

export { expect };
export type { Locator, Page };

/**
 * `text` as a whole-string pattern that tolerates the bidi marks the ar-XB pseudo-locale wraps
 * around literal segments (U+200F, F-207) and the isolates `t` adds around values (U+2068/U+2069).
 */
export function catalogText(text: string): RegExp {
  const marks = "[\\u200f\\u2068\\u2069]*";
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${marks}${escaped}${marks}$`);
}
