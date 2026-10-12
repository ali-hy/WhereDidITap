// The API server with its default contract and router (F-55, F-58, F-52, F-38, F-61). TP-4.7,
// TP-4.14, TP-4.15, TP-4.17 and TP-5.1 (moved to S-4, A-124).
import { API_VERSION } from "@budmon/contract";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import {
  SECURITY_HEADERS,
  registerSecurityHeaders,
} from "../../../src/platform/security/headers.js";
import {
  buildApiContainer,
  injectJson,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";

let built: BuiltContainer;
let app: FastifyInstance;
let obs: Observed;

beforeAll(async () => {
  obs = observed();
  built = await buildApiContainer(obs.overrides, {
    CLIENT_MIN_ANDROID: "3",
    CLIENT_LATEST_ANDROID: "5",
  });
  app = await createApiServer(built.container);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await built.close();
});

const NOT_FOUND = { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" };

describe("TP-4.7: GET /api/v1/meta/client-config", () => {
  it("TP-4.7: 200 with the exact body, X-Request-Id (32 hex) and X-Budmon-API-Version", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      apiVersion: API_VERSION,
      android: { minimumVersionCode: 3, latestVersionCode: 5, downloadUrl: null },
      web: { minimumBuild: 0 },
    });
    expect(String(res.headers["x-request-id"])).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers["x-budmon-api-version"]).toBe(API_VERSION);
  });
});

describe("TP-4.14: no CORS", () => {
  it("TP-4.14: OPTIONS with a foreign Origin is a 404 envelope with no Access-Control-* headers", async () => {
    const res = await injectJson(app, "OPTIONS", "/api/v1/meta/client-config", undefined, {
      origin: "https://evil.example",
      "access-control-request-method": "GET",
    });

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
    expect(
      Object.keys(res.headers).filter((h) => h.toLowerCase().startsWith("access-control-")),
    ).toEqual([]);
  });
});

describe("TP-4.15: unknown route", () => {
  it("TP-4.15: GET /api/v1/nope is 404 with exactly the NOT_FOUND envelope", async () => {
    const res = await injectJson(app, "GET", "/api/v1/nope");

    expect(res.status).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });
});

describe("TP-4.17: request log", () => {
  it("TP-4.17: one http_request line with the route template, status 200, no query field or canary; the counter incremented", async () => {
    const before = obs.capture.records().length;

    const res = await injectJson(app, "GET", `/api/v1/meta/client-config?x=${CANARIES.token}`);

    expect(res.status).toBe(200);
    const lines = obs.capture
      .records()
      .slice(before)
      .filter((l) => l["event"] === "http_request");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "/meta/client-config", status: 200 });
    expect(lines[0]).not.toHaveProperty("x");
    expect(scanForCanaries([{ name: "log", text: obs.capture.text() }], CANARIES)).toEqual([]);
    const counter = (await obs.collect()).get("http_server_requests_total");
    const point = counter?.dataPoints.find(
      (p) => p.attributes["http_route"] === "/meta/client-config",
    );
    expect(point?.value).toBeGreaterThanOrEqual(1);
  });
});

describe("TP-5.1: security headers (F-61)", () => {
  it("TP-5.1: GET /api/v1/meta/client-config carries CSP, HSTS, referrer policy and nosniff", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(String(res.headers["strict-transport-security"])).toContain("max-age=31536000");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("TP-5.1: helmet's other headers carry the values A-151 lists, and no other helmet header is sent", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect({
      "cross-origin-opener-policy": res.headers["cross-origin-opener-policy"],
      "origin-agent-cluster": res.headers["origin-agent-cluster"],
      "x-dns-prefetch-control": res.headers["x-dns-prefetch-control"],
      "x-download-options": res.headers["x-download-options"],
      "x-frame-options": res.headers["x-frame-options"],
      "x-permitted-cross-domain-policies": res.headers["x-permitted-cross-domain-policies"],
      "x-xss-protection": res.headers["x-xss-protection"],
    }).toEqual({
      "cross-origin-opener-policy": "same-origin",
      "origin-agent-cluster": "?1",
      "x-dns-prefetch-control": "off",
      "x-download-options": "noopen",
      "x-frame-options": "SAMEORIGIN",
      "x-permitted-cross-domain-policies": "none",
      "x-xss-protection": "0",
    });
    const helmetHeaders = [
      "content-security-policy",
      "content-security-policy-report-only",
      "cross-origin-embedder-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "origin-agent-cluster",
      "referrer-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-dns-prefetch-control",
      "x-download-options",
      "x-frame-options",
      "x-permitted-cross-domain-policies",
      "x-xss-protection",
    ];
    expect(helmetHeaders.filter((h) => h in res.headers).sort()).toEqual(
      [
        "content-security-policy",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
        "origin-agent-cluster",
        "referrer-policy",
        "strict-transport-security",
        "x-content-type-options",
        "x-dns-prefetch-control",
        "x-download-options",
        "x-frame-options",
        "x-permitted-cross-domain-policies",
        "x-xss-protection",
      ].sort(),
    );
  });
});

describe("TP-5.1: SECURITY_HEADERS matches helmet's output (A-182)", () => {
  /** Fastify's own response headers: everything else on the bare app comes from helmet. */
  const FASTIFY_HEADERS = new Set([
    "content-type",
    "content-length",
    "date",
    "connection",
    "keep-alive",
  ]);

  it("TP-5.1: helmet alone on a bare app sends exactly SECURITY_HEADERS, names and values", async () => {
    const bare = Fastify();
    await registerSecurityHeaders(bare);
    bare.get("/x", () => ({ ok: true }));
    await bare.ready();
    try {
      const res = await bare.inject({ method: "GET", url: "/x" });
      const helmet = Object.fromEntries(
        Object.entries(res.headers)
          .filter(([name]) => !FASTIFY_HEADERS.has(name))
          .map(([name, value]) => [name, String(value)]),
      );

      expect(res.statusCode).toBe(200);
      expect(helmet).toEqual(SECURITY_HEADERS);
    } finally {
      await bare.close();
    }
  });

  it("TP-5.1: the API's normal response carries every SECURITY_HEADERS entry with the same value", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    const sent = Object.fromEntries(
      Object.keys(SECURITY_HEADERS).map((name) => [name, String(res.headers[name])]),
    );
    expect(sent).toEqual(SECURITY_HEADERS);
  });
});
