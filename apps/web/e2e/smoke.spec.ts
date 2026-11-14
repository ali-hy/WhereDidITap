// The rehearsal's smoke test (F-195 step 14, A-446): S1 to S6 against the candidate through Caddy
// at E2E_BASE_URL (http://localhost:8080 in the rehearsal). Runs only in the `smoke` project.
// TP-16.19.
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let buildNumber = -1;

test("TP-16.19 S1: /version.json is 200, no-store, exactly { buildNumber: n ≥ 0 }", async ({
  request,
}) => {
  const r = await request.get("/version.json");

  expect(r.status()).toBe(200);
  expect(r.headers()["cache-control"] ?? "").toContain("no-store");
  const body = (await r.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["buildNumber"]);
  expect(Number.isInteger(body["buildNumber"])).toBe(true);
  expect(body["buildNumber"] as number).toBeGreaterThanOrEqual(0);
  buildNumber = body["buildNumber"] as number;
});

test("TP-16.19 S2: /health/ready is 200 {status: ready}", async ({ request }) => {
  const r = await request.get("/health/ready");

  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: "ready" });
});

test("TP-16.19 S3: client-config with X-Budmon-Client web/<n>: API version headers, request id, minimumBuild ≤ n", async ({
  request,
}) => {
  expect(buildNumber, "S1 ran first").toBeGreaterThanOrEqual(0);
  const r = await request.get("/api/v1/meta/client-config", {
    headers: { "X-Budmon-Client": `web/${String(buildNumber)}` },
  });

  expect(r.status()).toBe(200);
  const body = (await r.json()) as { apiVersion?: unknown; web?: { minimumBuild?: unknown } };
  const version = r.headers()["x-budmon-api-version"] ?? "";
  expect(version).toMatch(/^1\.\d+$/);
  expect(body.apiVersion).toBe(version);
  expect(r.headers()["x-request-id"] ?? "").not.toBe("");
  expect(body.web?.minimumBuild as number).toBeLessThanOrEqual(buildNumber);
});

test("TP-16.19 S4: an unmatched API path is the API's 404 NOT_FOUND envelope, not the SPA", async ({
  request,
}) => {
  const r = await request.get("/api/v1/smoke-no-such-route");

  expect(r.status()).toBe(404);
  expect(r.headers()["content-type"] ?? "").toMatch(/^application\/json/);
  expect(((await r.json()) as { code?: unknown }).code).toBe("NOT_FOUND");
});

test("TP-16.19 S5: the home page loads: one h1 in main#main, html[lang], no errors, assets 200", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost:8080").origin;
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.name}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.origin !== origin) return;
    if (res.status() >= 500) problems.push(`${String(res.status())} ${url.pathname}`);
    if (url.pathname.startsWith("/assets/") && res.status() !== 200) {
      problems.push(`asset ${String(res.status())} ${url.pathname}`);
    }
  });

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"] ?? "").toMatch(/^text\/html/);
  const heading = page.locator("main#main h1");
  await expect(heading).toHaveCount(1, { timeout: 15_000 });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  expect(((await heading.textContent()) ?? "").trim()).not.toBe("");
  expect(await page.locator("html").getAttribute("lang")).toMatch(/\S/);
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("TP-16.19 S6: an unknown page shows the not-found heading", async ({ page }) => {
  await page.goto("/smoke-no-such-page");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
