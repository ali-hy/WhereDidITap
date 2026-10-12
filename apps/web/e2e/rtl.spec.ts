// The pseudo-RTL run (D-38): locale ar-XB on /__fixtures/rtl-probe. TP-11.17. Runs in the
// pseudo-rtl project only. Probes are measured against the content box of their nearest
// [data-rtl-container] (A-330).
import { expect, test } from "./fixtures.js";

test("TP-11.17: start probes at the container's right edge, end probes at its left, mirror icons scaleX(-1), no-mirror icons not, no overflow; screenshot saved", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pseudo-rtl", "pseudo-rtl project only");
  await page.goto("/__fixtures/rtl-probe");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-XB");
  await page.locator("[data-rtl-probe]").first().waitFor();

  const probes = await page.$$eval("[data-rtl-probe]", (els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      const container = el.closest("[data-rtl-container]");
      const box = container?.getBoundingClientRect();
      const style = container === null ? null : getComputedStyle(container);
      const px = (v: string | undefined) => Number.parseFloat(v ?? "") || 0;
      return {
        kind: el.getAttribute("data-rtl-probe") ?? "",
        left: rect.left,
        right: rect.right,
        hasContainer: container !== null,
        containerLeft: (box?.left ?? 0) + px(style?.borderLeftWidth) + px(style?.paddingLeft),
        containerRight: (box?.right ?? 0) - px(style?.borderRightWidth) - px(style?.paddingRight),
        transform: getComputedStyle(el).transform,
        label: el.outerHTML.slice(0, 120),
      };
    }),
  );
  const kinds = new Set(probes.map((p) => p.kind));
  expect([...kinds]).toEqual(expect.arrayContaining(["mirror", "no-mirror", "start", "end"]));

  for (const p of probes) {
    if (p.kind === "start" || p.kind === "end") expect(p.hasContainer, p.label).toBe(true);
    if (p.kind === "start") {
      expect(Math.abs(p.right - p.containerRight), p.label).toBeLessThanOrEqual(1);
    }
    if (p.kind === "end") {
      expect(Math.abs(p.left - p.containerLeft), p.label).toBeLessThanOrEqual(1);
    }
    // scaleX(-1) computes to matrix(-1, 0, 0, 1, 0, 0).
    if (p.kind === "mirror") expect(p.transform, p.label).toMatch(/^matrix\(-1, 0, 0, 1,/);
    if (p.kind === "no-mirror") {
      expect(["none", "matrix(1, 0, 0, 1, 0, 0)"], p.label).toContain(p.transform);
    }
  }

  const overflow = await page.evaluate(
    () => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const shot = testInfo.outputPath("rtl-probe.png");
  await page.screenshot({ path: shot, fullPage: true });
  await testInfo.attach("rtl-probe.png", { path: shot, contentType: "image/png" });
});
