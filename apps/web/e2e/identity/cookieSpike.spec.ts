// TP-0.30: the LD-2 cookie spike (identity LLD DV-3, DV-7). A Secure, HttpOnly, SameSite=Strict
// `budmon_at` cookie set over plain http://localhost:<port> is stored and sent back. Required on
// Chromium (every PR); Firefox runs in its project (release candidates) and its result is recorded
// as an annotation. The page that sets the cookie is this spec's own HTTP server on loopback, so
// no identity code is involved; the stack's own origin, http://localhost:<E2E_WEB_PORT>, is opened
// too, so a resolver problem with `localhost` shows up in S-0 (§10.1).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "../fixtures.js";

const COOKIE = "budmon_at=spike-7f3a; Path=/api/v1; Max-Age=900; HttpOnly; Secure; SameSite=Strict";

let server: Server;
let origin = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/v1/spike/set") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": COOKIE });
      res.end(
        '<!doctype html><html lang="en"><title>spike</title><main><h1>Cookie set</h1></main></html>',
      );
      return;
    }
    if (req.url === "/api/v1/spike/echo") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(req.headers.cookie ?? "");
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://localhost:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

test("TP-0.30: a Secure HttpOnly SameSite=Strict cookie from http://localhost is stored and sent", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await page.goto(`${origin}/api/v1/spike/set`);
  const stored = (await context.cookies(origin)).find((c) => c.name === "budmon_at");
  const sent = await page.evaluate(async () => (await fetch("/api/v1/spike/echo")).text());
  const visibleToScript = await page.evaluate(() => document.cookie);
  testInfo.annotations.push({
    type: "TP-0.30 cookie spike",
    description: `${browserName}: stored=${String(stored !== undefined)}, sent=${String(sent.includes("budmon_at=spike-7f3a"))}`,
  });

  expect(stored).toMatchObject({
    name: "budmon_at",
    value: "spike-7f3a",
    domain: "localhost",
    path: "/api/v1",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  });
  expect(sent).toContain("budmon_at=spike-7f3a");
  expect(visibleToScript).not.toContain("budmon_at");
});

test("TP-0.30: the stack's web origin opens on http://localhost:<E2E_WEB_PORT>", async ({
  page,
}) => {
  const port = process.env["E2E_WEB_PORT"] ?? "4173";

  const response = await page.goto(`http://localhost:${port}/`);

  expect(response?.status()).toBe(200);
  await expect(page.locator("main#main h1")).toHaveCount(1);
});
