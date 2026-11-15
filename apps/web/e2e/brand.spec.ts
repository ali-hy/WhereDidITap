// P-A-513 (7), identity A-23, A-26 and A-33 (P-A-523): the visible name "wDit" and the favicon.
// TP-0b.10. The Android launcher icon is LauncherIconTest.kt's.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";

const TOKENS_CSS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/styles/tokens.css",
);

/** tokens.css's light-mode `--c-<name>` value, lower-cased. */
function lightToken(name: string): string {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const block = /:root\[data-theme="teal"\]\[data-mode="light"\]\s*\{([^}]*)\}/.exec(css)?.[1];
  if (block === undefined) throw new Error("no light teal block in tokens.css");
  const value = new RegExp(`--c-${name}:\\s*([^;]+);`).exec(block)?.[1];
  if (value === undefined) throw new Error(`no --c-${name} in tokens.css's light block`);
  return value.trim().toLowerCase();
}

const APP = "wDit";

test("TP-0b.10: index.html's static <title> is wDit, before any script runs", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  const html = await (await request.get("/")).text();

  expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(APP);
});

test("TP-0b.10: signed out, the header's wordmark has the accessible name wDit and dir=ltr; page titles end with ' – wDit'", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");

  // Signed out, / lands on the sign-in page (identity S-1, A-510).
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
  const wordmark = page.getByRole("banner").getByText(APP, { exact: true });

  await expect(wordmark).toHaveCount(1);
  await expect(wordmark).toHaveAttribute("dir", "ltr");
  await expect(wordmark).not.toHaveAttribute("aria-label", /.*/);
  await expect(page).toHaveTitle(`Sign in – ${APP}`);

  await page.evaluate(() => {
    history.pushState({}, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  });
  await expect(page).toHaveTitle(`Page not found – ${APP}`);

  await page.goto("/__fixtures/failing-loader");
  await expect(page).toHaveTitle(`Something went wrong on our side – ${APP}`);
  await expect(page.getByRole("banner").getByText(APP, { exact: true })).toHaveCount(1);
});

test("TP-0b.10 (A-33, P-A-523): /favicon.svg is a square accent <rect> with 22% corners, a white <path>, and no <text>", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  const accent = lightToken("accent");

  const res = await request.get("/favicon.svg");
  expect(res.status()).toBe(200);
  const svg = await res.text();
  await page.goto("/");
  const found = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const rects = [...doc.querySelectorAll("rect")];
    const paths = [...doc.querySelectorAll("path")];
    return {
      parseError: doc.querySelector("parsererror") !== null,
      texts: doc.querySelectorAll("text").length,
      rects: rects.map((r) => ({
        width: r.getAttribute("width"),
        height: r.getAttribute("height"),
        rx: r.getAttribute("rx"),
        fill: r.getAttribute("fill"),
      })),
      pathFills: paths.map((p) => p.getAttribute("fill")),
    };
  }, svg);

  expect(found.parseError).toBe(false);
  expect(found.texts).toBe(0);
  expect(found.rects).toHaveLength(1);
  const rect = found.rects[0];
  expect(rect?.width).not.toBeNull();
  expect(rect?.width).toBe(rect?.height);
  const rx = rect?.rx ?? "";
  if (rx.endsWith("%")) {
    expect(Number(rx.slice(0, -1))).toBe(22);
  } else {
    expect(Number(rx) / Number(rect?.width)).toBeCloseTo(0.22, 6);
  }
  expect(rect?.fill?.toLowerCase()).toBe(accent);
  expect(found.pathFills.length).toBeGreaterThan(0);
  for (const fill of found.pathFills) {
    expect(["#fff", "#ffffff", "white"]).toContain(fill?.toLowerCase());
  }
});
