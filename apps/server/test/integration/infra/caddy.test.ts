// The laptop's Caddy (F-175 Caddyfile) in the web image: maintenance answers, the API proxy, SPA
// and asset caching, headers on every response, an access log without query strings, canaries or
// headers (A-4), and no TLS (auto_https off). TP-15.13. A-502 (6): the API owns the security headers
// of the responses it sends, Caddy those of its own, each once (TP-15.52 (a)); A-502 (7): paths the
// laptop never serves are 404 (TP-15.53).
//
// The web image runs as Compose's caddy service. A-394: the stub API is the server image running an
// inline Node HTTP server on :3000 (alias `api`, the Caddyfile's upstream) that answers every request
// `200 {"stub":true}` and prints each request line, so no extra image is pulled and the test sees
// exactly what Caddy forwards. A-391: runs in the infra-int job (`pnpm test:infra`), skipped
// elsewhere.
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
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

/** TP-15.52: the headers the stub API sends on paths under /api/v1/h/ (F-61's shape). */
const API_HEADERS = {
  "content-security-policy": "default-src 'none';frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
};

/**
 * A-394: the stub API, about 20 lines of Node; one stdout line per request. TP-15.52: paths under
 * /api/v1/h/ also carry API_HEADERS; other paths none of them.
 */
const STUB_SERVER = `
const http = require("node:http");
const API_HEADERS = ${JSON.stringify(API_HEADERS)};
http
  .createServer((req, res) => {
    process.stdout.write("REQ " + req.method + " " + req.url + "\\n");
    req.resume();
    req.on("end", () => {
      const extra = req.url.startsWith("/api/v1/h/") ? API_HEADERS : {};
      res.writeHead(200, { "content-type": "application/json", ...extra });
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
  // A-502 (6): F-61's value, so the browser's stored policy doesn't depend on the response.
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

/** Request lines the stub API received since `since`. */
const stubRequests = (since: string) => {
  const r = sh("docker", ["logs", "--since", since, STUB]);
  return `${r.stdout}${r.stderr}`;
};

interface RawResponse {
  status: number;
  body: string;
  /** Node's rawHeaders: name, value, name, value, … as they came off the wire. */
  raw: string[];
}

/** A GET through Caddy, keeping the raw header list so duplicates can be counted. */
function rawGet(urlPath: string): Promise<RawResponse> {
  return rawRequest("GET", urlPath);
}

/** Any method through Caddy, with an optional client timeout (A-506's 502s take Caddy 10 s). */
function rawRequest(method: string, urlPath: string, timeoutMs = 0): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: 8080, path: urlPath, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body, raw: res.rawHeaders });
      });
    });
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`${method} ${urlPath}: no answer within ${String(timeoutMs)} ms`));
      });
    }
    req.on("error", reject);
    req.end();
  });
}

/** Every value of header `name` (case-insensitive) in a raw header list. */
function values(raw: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if ((raw[i] ?? "").toLowerCase() === name) out.push(raw[i + 1] ?? "");
  }
  return out;
}

const SECURITY = [
  "strict-transport-security",
  "content-security-policy",
  "referrer-policy",
  "x-content-type-options",
] as const;

/** Caddy's own four, once each, and no Cross-Origin-Resource-Policy (TP-15.52). */
function expectCaddyHeadersOnce(r: RawResponse, label: string): void {
  for (const name of SECURITY) expect(values(r.raw, name), `${label} ${name}`).toHaveLength(1);
  expect(values(r.raw, "strict-transport-security"), label).toEqual([
    "max-age=31536000; includeSubDomains",
  ]);
  expect(values(r.raw, "referrer-policy"), label).toEqual(["no-referrer"]);
  expect(values(r.raw, "x-content-type-options"), label).toEqual(["nosniff"]);
  expect(values(r.raw, "content-security-policy"), label).toEqual([CSP]);
  expect(values(r.raw, "cross-origin-resource-policy"), label).toEqual([]);
}

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

  // A-431: /assets/* is file_server only.
  it("TP-15.41: an existing asset is immutable; a missing one is a 404 with no-store and not index.html; /assets/ is 404; an SPA route has no immutable header", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
    expect(asset).toBeDefined();

    const hit = await fetch(`${BASE}${asset ?? "/assets/a.js"}`);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const missing = await fetch(`${BASE}/assets/missing.js`);
    const body = await missing.text();
    expect(missing.status).toBe(404);
    expect(body).toBe("");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("cache-control") ?? "").not.toContain("immutable");
    expect(body).not.toMatch(/<div id="root"/);

    const dir = await fetch(`${BASE}/assets/`);
    expect(dir.status).toBe(404);

    const route = await fetch(`${BASE}/some/route`);
    expect(route.status).toBe(200);
    expect(await route.text()).toMatch(/<div id="root"/);
    expect(route.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("TP-15.13: a TLS request to https://127.0.0.1:8080/ fails (plain HTTP only)", () => {
    const r = sh("curl", ["-k", "-sS", "--max-time", "10", "https://127.0.0.1:8080/"]);

    expect(r.status).not.toBe(0);
  });
});

// A-502 (6): the API owns the headers of its responses and Caddy those of its own, each once.
describe.skipIf(!INFRA_INT)(
  "TP-15.52 (a): security headers appear once on every response (F-175, F-61)",
  () => {
    it("TP-15.52 (a): /api/v1/h/x carries the API's four headers (and CORP) once each, none of Caddy's", async () => {
      const r = await rawGet("/api/v1/h/x");

      expect(r.status).toBe(200);
      for (const name of SECURITY) expect(values(r.raw, name), name).toEqual([API_HEADERS[name]]);
      expect(values(r.raw, "cross-origin-resource-policy")).toEqual(["same-origin"]);
    });

    it.each([
      ["/api/v1/x"],
      ["/health/ready"],
      ["/"],
      ["/some/route"],
      ["/version.json"],
      ["/assets/a.js"],
      ["/assets/missing.js"],
      ["/.env"],
    ])("TP-15.52 (a): %s carries Caddy's four headers once each, and no CORP", async (urlPath) => {
      expectCaddyHeadersOnce(await rawGet(urlPath), urlPath);
    });

    it("TP-15.52 (a): with the maintenance flag, /api/v1/h/x and /health/ready carry Caddy's four headers once each", async () => {
      writeFileSync(flag(), "");
      try {
        for (const urlPath of ["/api/v1/h/x", "/health/ready"]) {
          const r = await rawGet(urlPath);
          expect(r.status, urlPath).toBe(503);
          expectCaddyHeadersOnce(r, urlPath);
        }
      } finally {
        unlinkSync(flag());
      }
    });
  },
);

// A-502 (7): Caddy answers 404 for paths the laptop never serves, before the SPA fallback.
describe.skipIf(!INFRA_INT)("TP-15.53: paths the laptop never serves are 404 (F-175)", () => {
  const NOT_SERVED = [
    "/health/live",
    "/health",
    "/health/other",
    "/dev",
    "/dev/objects/x",
    "/.env",
    "/.git/config",
    "/a/.hidden",
    "/.well-known/x",
  ];

  it.each(NOT_SERVED.map((p) => [p]))(
    "TP-15.53: %s is 404 with an empty body and no-store, not index.html, and never reaches the API",
    async (urlPath) => {
      const since = new Date(Date.now() - 1_000).toISOString();

      const r = await rawGet(urlPath);

      expect(r.status).toBe(404);
      expect(r.body).toBe("");
      expect(values(r.raw, "cache-control")).toEqual(["no-store"]);
      expect(r.body).not.toMatch(/<div id="root"/);
      const lines = stubRequests(since)
        .split("\n")
        .map((l) => l.trim());
      expect(lines).not.toContain(`REQ GET ${urlPath}`);
    },
  );

  it("TP-15.53: with the maintenance flag, /health/live is still 404 (not 503)", async () => {
    writeFileSync(flag(), "");
    try {
      const r = await rawGet("/health/live");
      expect(r.status).toBe(404);
      expect(r.body).toBe("");
    } finally {
      unlinkSync(flag());
    }
  });

  it("TP-15.53: controls: /health/ready and /api/v1/x reach the API; /healthy and /some/route serve index.html", async () => {
    const since = new Date(Date.now() - 1_000).toISOString();

    expect((await rawGet("/health/ready")).status).toBe(200);
    expect((await rawGet("/api/v1/x")).status).toBe(200);
    const forwarded = stubRequests(since);
    expect(forwarded).toContain("REQ GET /health/ready");
    expect(forwarded).toContain("REQ GET /api/v1/x");
    for (const urlPath of ["/healthy", "/some/route"]) {
      const r = await rawGet(urlPath);
      expect(r.status, urlPath).toBe(200);
      expect(r.body, urlPath).toMatch(/<div id="root"/);
    }
  });
});

// A-506 (1): Caddy's own error responses (handle_errors) carry its four headers too. Last in the
// file: it stops the stub API, so Docker's DNS no longer resolves `api`.
describe.skipIf(!INFRA_INT)(
  "TP-15.52 (c): Caddy's own errors keep the security headers (F-175)",
  () => {
    function expectEmptyError(r: RawResponse, label: string): void {
      expect(r.body, label).toBe("");
      expect(values(r.raw, "content-length"), label).toEqual(["0"]);
      expectCaddyHeadersOnce(r, label);
    }

    it("TP-15.52 (c): POST / is file_server's 405 with Allow: GET, HEAD, an empty body and Caddy's four headers once", async () => {
      const r = await rawRequest("POST", "/", 30_000);

      expect(r.status).toBe(405);
      expect(values(r.raw, "allow")).toEqual(["GET, HEAD"]);
      expectEmptyError(r, "POST /");
    });

    it("TP-15.52 (c): with the stub API stopped, /api/v1/x and /health/ready are 502s with an empty body and Caddy's four headers once", async () => {
      const stop = sh("docker", ["stop", STUB]);
      expect(stop.status, stop.stderr).toBe(0);

      for (const urlPath of ["/api/v1/x", "/health/ready"]) {
        const r = await rawRequest("GET", urlPath, 30_000);
        expect(r.status, urlPath).toBe(502);
        expectEmptyError(r, urlPath);
      }
    }, 90_000);
  },
);
