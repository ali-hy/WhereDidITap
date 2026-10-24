// The favicon (A-466): /favicon.svg, no /favicon.ico request, no console error. TP-11.31.
import { expect, test } from "./fixtures.js";

test("TP-11.31 (A-466): / loads /favicon.svg as image/svg+xml, requests no /favicon.ico, logs no console error; the file is small and self-contained", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  const requested: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toBe("/favicon.svg");
  expect(requested).not.toContain("/favicon.ico");
  expect(errors).toEqual([]);

  const res = await request.get("/favicon.svg");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"] ?? "").toMatch(/^image\/svg\+xml/);
  const body = await res.body();
  expect(body.length).toBeLessThan(1024);
  const svg = body.toString("utf8");
  expect(svg).not.toMatch(/<text[\s>]/);
  // No external reference: no href or url() other than fragment references.
  expect(svg).not.toMatch(/(?:href|src)\s*=\s*["'](?!#)/);
  expect(svg).not.toMatch(/url\(\s*["']?(?!#)/);
});
