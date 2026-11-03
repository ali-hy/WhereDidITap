// The accessibility report is non-blocking (D-39). TP-11.14.
import { attachAxeReport, expect, test } from "./fixtures.js";

test("TP-11.14: a page with an axe violation passes, and the attached axe report lists the violation", async ({
  page,
}, testInfo) => {
  await page.goto("/__fixtures/a11y-violation");

  const report = await attachAxeReport(page, testInfo);

  expect(report).not.toBeNull();
  // T-3: the fixture's planted violation (A-332), not just any.
  expect(report?.violations.some((v) => v.id === "color-contrast")).toBe(true);
  expect(testInfo.attachments.map((a) => a.name)).toContain("axe-report.json");
});
