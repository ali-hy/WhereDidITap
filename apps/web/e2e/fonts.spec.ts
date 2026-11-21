// P-A-513 (2) fonts: self-hosted, with Noto Sans Arabic only for Arabic text (guide §4.1, D-38 rule
// 12). TP-0b.5. The Arabic "fixture" is a paragraph the test adds to the page.
import { expect, test, type Page } from "./fixtures.js";

interface Face {
  family: string;
  status: string;
}

/** The document's font faces, with their load status. */
async function faces(page: Page): Promise<Face[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => ({
      family: f.family.replace(/["']/g, ""),
      status: f.status,
    }));
  });
}

const loaded = (list: Face[], family: string) =>
  list.some((f) => f.family === family && f.status === "loaded");

test("TP-0b.5: Latin only loads IBM Plex Sans and not Noto Sans Arabic; Arabic text loads Noto Sans Arabic; every font is from the app's origin", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") fontRequests.push(r.url());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const latin = await faces(page);

  expect(latin.some((f) => f.family === "IBM Plex Sans")).toBe(true);
  expect(loaded(latin, "IBM Plex Sans")).toBe(true);
  expect(loaded(latin, "Noto Sans Arabic")).toBe(false);
  expect(fontRequests.length).toBeGreaterThan(0);

  await page.evaluate(() => {
    const p = document.createElement("p");
    p.lang = "ar";
    p.dir = "rtl";
    p.textContent = "مرحبا بك في التطبيق";
    (document.querySelector("main") ?? document.body).append(p);
  });
  await expect.poll(async () => loaded(await faces(page), "Noto Sans Arabic")).toBe(true);

  const origin = new URL(page.url()).origin;
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) {
    expect(new URL(url).origin).toBe(origin);
    expect(new URL(url).pathname).toMatch(/\.woff2$/);
  }
});
