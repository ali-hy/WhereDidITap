// Platform A-526: index.html preloads the two IBM Plex Sans weights every page uses. Identity
// TP-1.42 (built in identity S-1).
import { expect, test } from "./fixtures.js";

const PRELOADED = ["ibm-plex-sans-latin-400-normal.woff2", "ibm-plex-sans-latin-600-normal.woff2"];

test("TP-1.42 (A-526): /sign-in in a cold context: exactly two font preloads (Plex Sans 400 and 600), each file requested once, no preload warning", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  const context = await browser.newContext();
  const page = await context.newPage();
  const fontRequests: string[] = [];
  const messages: string[] = [];
  page.on("request", (r) => {
    const name = new URL(r.url()).pathname.split("/").pop() ?? "";
    if (name.endsWith(".woff2")) fontRequests.push(name);
  });
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") messages.push(m.text());
  });

  await page.goto("/sign-in");
  await page.locator("main h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Chrome reports an unused preload a few seconds after load.
  await page.waitForTimeout(3_500);

  const preloads = await page.$$eval('head link[rel="preload"]', (links) =>
    links.map((l) => ({
      as: l.getAttribute("as"),
      type: l.getAttribute("type"),
      crossorigin: l.hasAttribute("crossorigin"),
      file: (l.getAttribute("href") ?? "").split("/").pop(),
    })),
  );
  const fontPreloads = preloads.filter((p) => p.as === "font");
  expect(fontPreloads).toHaveLength(2);
  expect(fontPreloads.map((p) => p.file).sort()).toEqual(PRELOADED);
  for (const p of fontPreloads) {
    expect(p).toMatchObject({ type: "font/woff2", crossorigin: true });
  }
  for (const file of PRELOADED) {
    expect(
      fontRequests.filter((f) => f === file),
      file,
    ).toHaveLength(1);
  }
  expect(messages.filter((m) => /preload/i.test(m))).toEqual([]);
  await context.close();
});
