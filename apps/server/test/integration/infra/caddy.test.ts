// The laptop's Caddy (F-175 Caddyfile) in the web image: maintenance answers, the API proxy, SPA
// and asset caching, headers on every response, an access log without query strings, canaries or
// headers (A-4), and no TLS (auto_https off). TP-15.13.
//
// The web image runs as Compose's caddy service. A-394: the stub API is the server image running an
// inline Node HTTP server on :3000 (alias `api`, the Caddyfile's upstream) that answers every request
// `200 {"stub":true}` and prints each request line, so no extra image is pulled and the test sees
// exactly what Caddy forwards. A-391: runs in the infra-int job (`pnpm test:infra`), skipped
// elsewhere.
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImage, compose, INFRA_INT, laptopHome, sh, TEST_TAG } from "./support.js";

const PROJECT = `budmon-tp15-caddy-${String(process.pid)}`;
const STUB = `${PROJECT}-api`;
const BASE = "http://127.0.0.1:8080";
const CANARY = "CANARY-caddy-tp-15-13-7f3a";
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.de.sentry.io https://*.ingest.sentry.io; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const MAINT_BODY =
  '{"defined":true,"code":"SERVICE_UNAVAILABLE","status":503,"message":"Service unavailable","data":{"outcome":"not_applied"}}';

/** A-394: the stub API, about 20 lines of Node; one stdout line per request. */
const STUB_SERVER = `
const http = require("node:http");
http
  .createServer((req, res) => {
    process.stdout.write("REQ " + req.method + " " + req.url + "\\n");
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"stub":true}');
    });
  })
  .listen(3000, "0.0.0.0");
`;

let home = "";
let createdNetwork = false;

beforeAll(async () => {
  if (!INFRA_INT) return;
  buildImage("web");
  buildImage("server");
  home = laptopHome({});
  if (sh("docker", ["network", "inspect", "budmon_capture_db"]).status !== 0) {
    sh("docker", [
      "network",
      "create",
      "--internal",
      "--subnet",
      "172.30.42.0/29",
      "budmon_capture_db",
    ]);
    createdNetwork = true;
  }
  const up = compose(PROJECT, home, ["up", "-d", "--no-deps", "caddy"]);
  if (up.status !== 0) throw new Error(`compose up caddy: ${up.stderr}`);
  const stub = sh("docker", [
    "run",
    "-d",
    "--name",
    STUB,
    "--network",
    `${PROJECT}_edge`,
    "--network-alias",
    "api",
    "--entrypoint",
    "node",
    `budmon/server:${TEST_TAG}`,
    "-e",
    STUB_SERVER,
  ]);
  if (stub.status !== 0) throw new Error(`stub api: ${stub.stderr}`);
  for (let i = 0; i < 30; i += 1) {
    try {
      await fetch(`${BASE}/version.json`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error("caddy never answered");
}, 1_800_000);

afterAll(() => {
  if (!INFRA_INT) return;
  sh("docker", ["rm", "-f", STUB]);
  if (home === "") return;
  compose(PROJECT, home, ["down", "-v", "--remove-orphans"]);
  if (createdNetwork) sh("docker", ["network", "rm", "budmon_capture_db"]);
  rmSync(home, { recursive: true, force: true });
});

const flag = () => path.join(home, "maintenance/on");

function expectHeaders(res: Response): void {
  expect(res.headers.get("content-security-policy")).toBe(CSP);
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

/** Request lines the stub API received since `since`. */
const stubRequests = (since: string) => {
  const r = sh("docker", ["logs", "--since", since, STUB]);
  return `${r.stdout}${r.stderr}`;
};

describe.skipIf(!INFRA_INT)("TP-15.13: Caddy on the laptop (F-175)", () => {
  it('TP-15.13: with the maintenance flag, /api/* is the exact 503 envelope with Retry-After 120, and /health/ready is {"status":"maintenance"} 503', async () => {
    writeFileSync(flag(), "");
    try {
      const api = await fetch(`${BASE}/api/v1/x`);
      expect(api.status).toBe(503);
      expect(await api.text()).toBe(MAINT_BODY);
      expect(api.headers.get("retry-after")).toBe("120");
      expect(api.headers.get("content-type")).toMatch(/^application\/json/);
      expectHeaders(api);

      const ready = await fetch(`${BASE}/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.text()).toBe('{"status":"maintenance"}');
      expectHeaders(ready);
    } finally {
      unlinkSync(flag());
    }
  });

  it("TP-15.13: without the flag, /api/* and the Google callback reach the API; the access log has bare paths, no canary and no headers", async () => {
    const since = new Date().toISOString();

    const a = await fetch(`${BASE}/api/v1/x?token=${CANARY}`, {
      headers: { Authorization: `Bearer ${CANARY}` },
    });
    const b = await fetch(`${BASE}/api/v1/auth/google/callback?code=${CANARY}&state=${CANARY}`);

    expect(a.status).toBe(200);
    expect(await a.text()).toBe('{"stub":true}');
    expect(b.status).toBe(200);
    expectHeaders(a);
    // A-394: the stub saw what Caddy forwarded: full URLs, query strings included.
    const forwarded = stubRequests(since);
    expect(forwarded).toContain(`REQ GET /api/v1/x?token=${CANARY}`);
    expect(forwarded).toContain(`REQ GET /api/v1/auth/google/callback?code=${CANARY}`);
    const logs = compose(PROJECT, home, ["logs", "--no-log-prefix", "--since", since, "caddy"]);
    const text = `${logs.stdout}${logs.stderr}`;
    expect(text).toContain("/api/v1/auth/google/callback");
    expect(text).not.toContain(CANARY);
    expect(text).not.toMatch(/\/api\/v1\/x\?/);
    expect(text).not.toMatch(/callback\?/);
    expect(text).not.toMatch(/"headers"\s*:\s*\{\s*"/);
    expect(text).not.toMatch(/Authorization/i);
  });

  it("TP-15.13: /some/route serves index.html; /version.json has Cache-Control no-store; /assets/* are immutable", async () => {
    const route = await fetch(`${BASE}/some/route`);
    const html = await route.text();
    expect(route.status).toBe(200);
    expect(html).toMatch(/<div id="root"/);
    expectHeaders(route);

    const version = await fetch(`${BASE}/version.json`);
    expect(version.status).toBe(200);
    expect(version.headers.get("cache-control")).toBe("no-store");

    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
    expect(asset).toBeDefined();
    const res = await fetch(`${BASE}${asset ?? "/assets/a.js"}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expectHeaders(res);
  });

  // A-419: Caddy binds only :8080, so it runs without the file capability under the Compose
  // settings (cap_drop ALL, no-new-privileges, user 10005, read-only root).
  it("TP-15.33 (I): getcap /usr/bin/caddy prints nothing; the container is running (not restarting) and answers on 8080", async () => {
    const getcap = compose(PROJECT, home, ["exec", "-T", "caddy", "getcap", "/usr/bin/caddy"]);
    expect(getcap.status, getcap.stderr).toBe(0);
    expect(getcap.stdout.trim()).toBe("");

    const id = compose(PROJECT, home, ["ps", "-q", "caddy"]).stdout.trim();
    const state = sh("docker", ["inspect", "-f", "{{.State.Status}} {{.State.Restarting}}", id]);
    expect(state.stdout.trim()).toBe("running false");

    const res = await fetch(`${BASE}/version.json`);
    expect(res.status).toBe(200);
  });

  it("TP-15.13: a TLS request to https://127.0.0.1:8080/ fails (plain HTTP only)", () => {
    const r = sh("curl", ["-k", "-sS", "--max-time", "10", "https://127.0.0.1:8080/"]);

    expect(r.status).not.toBe(0);
  });
});
