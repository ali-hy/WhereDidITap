// F-217 web Sentry: init options and scrubbing. TP-11.25, plus extra cases TP-11.32x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definedError, loadSentry } from "../support/s11b.js";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/solid", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  init: sentry.init,
}));

// A privacy canary (F-198's shape) standing in for user data in an error message.
const CANARY = "CANARY-web-tp-11-25-7f3a";

interface InitOptions {
  dsn?: string;
  release?: string;
  environment?: string;
  sendDefaultPii?: boolean;
  dataCollection?: Record<string, unknown>;
  integrations?: unknown;
  beforeSend?: (e: Record<string, unknown>, hint?: unknown) => unknown;
  beforeBreadcrumb?: (b: Record<string, unknown>, hint?: unknown) => unknown;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  defaultIntegrations?: unknown;
  sendClientReports?: unknown;
}

beforeEach(() => {
  sentry.init.mockClear();
});

async function initOptions(): Promise<InitOptions> {
  const { initWebSentry } = await loadSentry();
  initWebSentry({ dsn: "https://k@o1.ingest.sentry.io/2", release: "web@7", environment: "test" });
  expect(sentry.init).toHaveBeenCalledTimes(1);
  return sentry.init.mock.calls[0]?.[0] as InitOptions;
}

function integrationNames(integrations: unknown): string[] {
  const list: unknown =
    typeof integrations === "function"
      ? // Defaults that include what must be removed, so the filter is exercised.
        (integrations as (d: unknown[]) => unknown)([
          { name: "Breadcrumbs" },
          { name: "Replay" },
          { name: "BrowserTracing" },
        ])
      : integrations;
  return Array.isArray(list)
    ? list.map((i) => {
        const name = (i as { name?: unknown }).name;
        return typeof name === "string" ? name : "";
      })
    : [];
}

describe("TP-11.25: web Sentry scrubbing (F-217)", () => {
  it("TP-11.25: scrubWebEvent strips the query from request.url and replaces exception.value (a canary)", async () => {
    const { scrubWebEvent } = await loadSentry();
    const event = {
      event_id: "0123456789abcdef0123456789abcdef",
      request: { url: "https://budmon.example/api/v1/things?token=abc&q=" + CANARY },
      exception: { values: [{ type: "TypeError", value: `Cannot read ${CANARY}` }] },
    };

    const scrubbed = scrubWebEvent(event);

    expect(scrubbed).not.toBeNull();
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("token=abc");
    const url = (scrubbed?.["request"] as { url?: string } | undefined)?.url ?? "";
    expect(url).not.toContain("?");
    expect(url).toMatch(/\/api\/v1\/things$/);
    // F-217, A-495: stripped to the path, so no host.
    expect(scrubbed?.["request"]).toEqual({ url: "/api/v1/things" });
    expect(text).not.toContain("budmon.example");
    const values = (scrubbed?.["exception"] as { values?: { value?: string }[] } | undefined)
      ?.values;
    expect(values?.[0]?.value).toBe("TypeError");
  });

  it.each([
    [`/things?q=${CANARY}`, "/things"],
    ["https://budmon.example/things?q=x", "/things"],
  ])("TP-11.25 (A-495): transaction %s → %s", async (transaction, expected) => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ transaction });

    expect(scrubbed?.["transaction"]).toBe(expected);
    expect(JSON.stringify(scrubbed)).not.toContain("budmon.example");
    expect(JSON.stringify(scrubbed)).not.toContain(CANARY);
  });

  it.each([
    ["https://laptop.tail1234.ts.net:8443", "/"],
    ["//h/x", "/x"],
    ["blob:https://h/x", "/x"],
    ["/b?q=x#f", "/b"],
  ])("TP-11.25 (A-495): stripToPath(%s) → %s", async (url, expected) => {
    const { stripToPath } = await loadSentry();

    expect(stripToPath(url)).toBe(expected);
  });

  // A-499: whatever isn't a path after A-495's steps becomes "/".
  it.each([
    ["data:text/plain;base64,SGk="],
    ["mailto:a@b.example"],
    ["javascript:void(0)"],
    ["localhost:8080/x"],
    ["api/v1/things"],
  ])("TP-11.25 (A-499): stripToPath(%s) → /", async (url) => {
    const { stripToPath } = await loadSentry();

    expect(stripToPath(url)).toBe("/");
  });

  it("TP-11.25 (A-499): a fetch crumb with a data: URL keeps url exactly /, and neither the canary nor its base64", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();
    const encoded = btoa(CANARY);

    const kept = scrubWebBreadcrumb({
      category: "fetch",
      data: { method: "GET", url: `data:text/plain;base64,${encoded}` },
    });

    expect((kept as { data?: { url?: unknown } } | null)?.data?.url).toBe("/");
    const text = JSON.stringify(kept);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(encoded);
  });

  it("TP-11.25 (A-499): request.url mailto:<canary>@b.example → request exactly { url: / }", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ request: { url: `mailto:${CANARY}@b.example` } });

    expect(scrubbed?.["request"]).toEqual({ url: "/" });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(btoa(CANARY));
  });

  it.each([["things/{id}"], ["mailto:a@b.example"]])(
    "TP-11.25 (A-499): route %s isn't a path, so there's no route tag",
    async (route) => {
      const { scrubWebEvent } = await loadSentry();

      const scrubbed = scrubWebEvent({ tags: { route, custom: CANARY } });

      const tags = (scrubbed?.["tags"] ?? {}) as Record<string, unknown>;
      expect(Object.keys(tags)).not.toContain("route");
      expect(JSON.stringify(scrubbed)).not.toContain(CANARY);
    },
  );

  it("TP-11.25 (A-499): route https://budmon.example/things?q=x → /things", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ tags: { route: "https://budmon.example/things?q=x" } });

    expect(scrubbed?.["tags"]).toEqual({ route: "/things" });
  });

  // A-499 (2): an empty path part reads as "/", which passes the route rule.
  it.each([["https://h"], ["//h"]])(
    "TP-11.25 (A-499): route %s has an empty path, so the route tag is exactly /",
    async (route) => {
      const { scrubWebEvent } = await loadSentry();

      expect(scrubWebEvent({ tags: { route } })?.["tags"]).toEqual({ route: "/" });
    },
  );

  it("TP-11.32x: the transaction name loses its query", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ transaction: `/things?q=${CANARY}` });

    expect(JSON.stringify(scrubbed)).not.toContain(CANARY);
  });

  it("TP-11.25 (A-371): init options: dataCollection with every flag off, no sendDefaultPii key, no Replay or browser tracing, release and environment as given, beforeSend and beforeBreadcrumb set", async () => {
    const options = await initOptions();

    expect(options.dsn).toBe("https://k@o1.ingest.sentry.io/2");
    expect(options.release).toBe("web@7");
    expect(options.environment).toBe("test");
    expect(Object.keys(options)).not.toContain("sendDefaultPii");
    const collection = options.dataCollection;
    expect(collection).toBeDefined();
    for (const [flag, value] of Object.entries(collection ?? {})) {
      const off = value === false || value === 0 || (Array.isArray(value) && value.length === 0);
      expect(off, `dataCollection.${flag} = ${JSON.stringify(value)}`).toBe(true);
    }
    const names = integrationNames(options.integrations);
    expect(names.filter((n) => /replay|tracing/i.test(n))).toEqual([]);
    expect(options.replaysSessionSampleRate ?? 0).toBe(0);
    expect(options.replaysOnErrorSampleRate ?? 0).toBe(0);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");

    const sent = options.beforeSend?.({
      request: { url: `https://budmon.example/x?q=${CANARY}` },
    });
    expect(JSON.stringify(sent)).not.toContain(CANARY);
  });

  it("TP-11.25 (A-502 (1)): init options: defaultIntegrations false, exactly seven integrations in order, sendClientReports false, no autoSessionTracking", async () => {
    const options = await initOptions();

    expect(options.defaultIntegrations).toBe(false);
    expect(Array.isArray(options.integrations)).toBe(true);
    expect(integrationNames(options.integrations)).toEqual([
      "EventFilters",
      "FunctionToString",
      "BrowserApiErrors",
      "Breadcrumbs",
      "GlobalHandlers",
      "LinkedErrors",
      "Dedupe",
    ]);
    expect(options.sendClientReports).toBe(false);
    expect(Object.keys(options)).not.toContain("autoSessionTracking");
  });

  it("TP-11.25 (A-371): without a DSN, init isn't called", async () => {
    const { initWebSentry } = await loadSentry();

    initWebSentry({ release: "web@7", environment: "test" });

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("TP-11.32x: beforeBreadcrumb keeps navigation and fetch/xhr with the URL path only, and drops other categories", async () => {
    const options = await initOptions();
    const crumb = options.beforeBreadcrumb;
    expect(crumb).toBeTypeOf("function");
    if (crumb === undefined) return;

    expect(crumb({ category: "console", message: CANARY })).toBeNull();
    expect(crumb({ category: "ui.click", message: CANARY })).toBeNull();
    for (const category of ["fetch", "xhr"]) {
      const kept = crumb({
        category,
        data: { method: "GET", url: `https://budmon.example/api/v1/things?q=${CANARY}` },
      });
      expect(kept).not.toBeNull();
      expect(JSON.stringify(kept)).not.toContain(CANARY);
      expect(JSON.stringify(kept)).toContain("/api/v1/things");
      // F-217: the path only, no host.
      expect((kept as { data?: { url?: unknown } } | null)?.data?.url).toBe("/api/v1/things");
      expect(JSON.stringify(kept)).not.toContain("budmon.example");
    }
    const nav = crumb({ category: "navigation", data: { from: "/a?x=1", to: `/b?q=${CANARY}` } });
    expect(nav).not.toBeNull();
    expect(JSON.stringify(nav)).not.toContain(CANARY);
  });

  // T-2 (A-370): the DSN gate uses F-10's SENTRY_DSN pattern for the environment.
  it.each([
    ["http://k@sentry.example/1", "production", false],
    ["https://k@host/1?x=1", "production", false],
    ["https://k@o1.ingest.sentry.io/1", "production", true],
    ["http://k@localhost:9000/1", "development", true],
  ] as const)("TP-11.25 (A-370): DSN %s in %s initialises: %s", async (dsn, environment, inits) => {
    const { initWebSentry } = await loadSentry();

    initWebSentry({ dsn, release: "web@7", environment });

    expect(sentry.init).toHaveBeenCalledTimes(inits ? 1 : 0);
  });

  // T-2 (F-35's allowlist): everything outside it goes, and no canary survives.
  it("TP-11.25: scrubWebEvent keeps exactly F-35's allowlist (user, extra, tags, contexts, request headers/cookies/data)", async () => {
    const { scrubWebEvent } = await loadSentry();
    const event = {
      event_id: "0123456789abcdef0123456789abcdef",
      timestamp: 1_760_000_000,
      platform: "javascript",
      level: "error",
      release: "web@7",
      environment: "production",
      user: {
        id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        email: CANARY,
        ip_address: "203.0.113.9",
      },
      extra: { note: CANARY },
      tags: { route: "/things", custom: CANARY },
      contexts: {
        device: { model: CANARY },
        trace: {
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          span_id: "00f067aa0ba902b7",
          op: CANARY,
        },
      },
      request: {
        url: "https://budmon.example/api/v1/things",
        headers: { authorization: `Bearer ${CANARY}` },
        cookies: `session=${CANARY}`,
        data: { note: CANARY },
      },
      exception: { values: [{ type: "TypeError", value: CANARY }] },
    };

    const scrubbed = scrubWebEvent(event) ?? {};

    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("203.0.113.9");
    const ALLOWED = new Set([
      "breadcrumbs",
      "contexts",
      "environment",
      "event_id",
      "exception",
      "level",
      "platform",
      "release",
      "request",
      "tags",
      "timestamp",
      "transaction",
      "user",
    ]);
    expect(Object.keys(scrubbed).filter((k) => !ALLOWED.has(k))).toEqual([]);
    for (const k of ["event_id", "timestamp", "platform", "level", "release", "environment"]) {
      expect(scrubbed[k], k).toEqual(event[k as keyof typeof event]);
    }
    expect(Object.keys(scrubbed["user"] ?? {})).not.toContain("email");
    expect(Object.keys(scrubbed["user"] ?? {})).not.toContain("ip_address");
    expect(Object.keys(scrubbed["tags"] ?? {})).not.toContain("custom");
    expect(Object.keys(scrubbed["contexts"] ?? {})).not.toContain("device");
    // A-495: the path only, no scheme or host.
    expect(scrubbed["request"]).toEqual({ url: "/api/v1/things" });
    expect(JSON.stringify(scrubbed)).not.toContain("budmon.example");
  });

  it("TP-11.25: F-35's allowlist keeps a UUID user.id, an allowed tag and contexts.trace's ids", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed =
      scrubWebEvent({
        event_id: "0123456789abcdef0123456789abcdef",
        user: { id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", email: CANARY },
        tags: { route: "/things", custom: CANARY },
        contexts: {
          trace: { trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", span_id: "00f067aa0ba902b7" },
        },
      }) ?? {};

    expect(scrubbed["user"]).toEqual({ id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
    expect(scrubbed["tags"]).toEqual({ route: "/things" });
    expect(scrubbed["contexts"]).toEqual({
      trace: { trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", span_id: "00f067aa0ba902b7" },
    });
  });

  // B-5: the value is the key only for an oRPC defined error, from the original exception.
  it("TP-11.25 (B-5): a defined ORPCError's value is its key; a key-shaped plain Error's value is its class name", async () => {
    const options = await initOptions();
    const send = options.beforeSend;
    expect(send).toBeTypeOf("function");
    if (send === undefined) return;

    const defined = send(
      { exception: { values: [{ type: "ORPCError", value: "Not found" }] } },
      { originalException: await definedError("NOT_FOUND", 404) },
    ) as { exception?: { values?: { value?: string }[] } } | null;
    expect(defined?.exception?.values?.[0]?.value).toBe("NOT_FOUND");

    const postcode = send(
      { exception: { values: [{ type: "Error", value: "SW1A1AA" }] } },
      { originalException: new Error("SW1A1AA") },
    ) as { exception?: { values?: { value?: string }[] } } | null;
    expect(postcode?.exception?.values?.[0]?.value).toBe("Error");
    expect(JSON.stringify(postcode)).not.toContain("SW1A1AA");
  });
});

// ---- A-485: frame filenames reduced as on the server ----

type Frame = Record<string, unknown>;

async function reducer(): Promise<(f: string) => string> {
  // Typed loosely so this file compiles before reduceFrameFilename exists.
  const mod = (await loadSentry()) as unknown as Record<string, unknown>;
  const fn = mod["reduceFrameFilename"];
  expect(fn, "reduceFrameFilename is exported").toBeTypeOf("function");
  return fn as (f: string) => string;
}

const at = (filename: string | undefined, extra: Frame = {}): Frame => ({
  ...(filename === undefined ? {} : { filename }),
  function: "run",
  lineno: 3,
  colno: 9,
  in_app: true,
  ...extra,
});

const FRAMES: [string, Frame][] = [
  [
    "(a)",
    at("https://laptop.tail1234.ts.net/assets/index-AbC1.js?v=1#x", {
      abs_path: `https://laptop.tail1234.ts.net/assets/${CANARY}.js`,
      module: CANARY,
      context_line: CANARY,
      pre_context: [CANARY],
      vars: { note: CANARY },
    }),
  ],
  ["(b)", at("http://localhost:5173/assets/chunk/x-1.js")],
  ["(c)", at(`https://laptop.tail1234.ts.net/src/${CANARY}.ts`)],
  ["(d)", at(`chrome-extension://abc/${CANARY}.js`)],
  ["(e)", at("<anonymous>")],
  ["(f)", at("assets/index-AbC1.js")],
  ["(g)", at(`https://h/assets/../${CANARY}.js`)],
  ["(h)", at("https://h/assets/%2e%2e/x.js")],
  ["(i)", at(undefined)],
  ["(j)", at("")],
  ["(k)", at("https://h/assets/a.js", { function: `x ${CANARY} y` })],
];

describe("TP-11.25 (A-485): scrubWebEvent reduces frame filenames and drops frames without one", () => {
  it("TP-11.25 (A-485): (a)-(k) → kept frames (a) (b) (c) (d) (e) (f) (g) (h) with reduced filenames; (i) (j) (k) dropped; no host, extension or canary left", async () => {
    const { scrubWebEvent } = await loadSentry();
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "x",
            stacktrace: { frames: FRAMES.map(([, f]) => f) },
          },
        ],
      },
    };

    const scrubbed = scrubWebEvent(event);
    const values = (scrubbed?.["exception"] as { values?: { stacktrace?: { frames?: Frame[] } }[] })
      .values;
    const frames = values?.[0]?.stacktrace?.frames ?? [];

    expect(frames.map((f) => f["filename"])).toEqual([
      "assets/index-AbC1.js",
      "assets/chunk/x-1.js",
      "<unknown>",
      "<unknown>",
      "<unknown>",
      "assets/index-AbC1.js",
      "<unknown>",
      "<unknown>",
    ]);
    expect(Object.keys(frames[0] ?? {}).sort()).toEqual(
      ["colno", "filename", "function", "in_app", "lineno"].sort(),
    );
    expect(frames[0]).toEqual({
      filename: "assets/index-AbC1.js",
      function: "run",
      lineno: 3,
      colno: 9,
      in_app: true,
    });
    const text = JSON.stringify(scrubbed);
    for (const banned of ["ts.net", "localhost", "chrome-extension", CANARY]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it.each(FRAMES.slice(0, 8))(
    "TP-11.25 (A-485): reduceFrameFilename is idempotent for %s",
    async (_label, frame) => {
      const reduce = await reducer();
      const once = reduce(String(frame["filename"]));

      expect(reduce(once)).toBe(once);
    },
  );
});

// ---- A-500: stripToPath parses with the WHATWG URL parser and keeps an http(s) path only ----

const H = "laptop.tail1234.ts.net";
const B64 = btoa(CANARY);

describe("TP-11.25 (A-500): stripToPath is httpPath(url) ?? /", () => {
  it.each([
    [`data:/,${CANARY}`],
    [`data:/;base64,${B64}`],
    [`data://h/,${CANARY}`],
    [`DATA:/,${CANARY}`],
    [`javascript:/${CANARY}`],
    [`blob:data:/,${CANARY}`],
    ["blob:blob:https://h/x"],
    ["ftp://h/x"],
    ["file:///etc/x"],
    ["chrome-extension://abc/x.js"],
    ["https://"],
    [""],
    ["?q=x"],
    ["../x"],
    [" /x"],
  ])("TP-11.25 (A-500): stripToPath(%j) → /", async (url) => {
    const { stripToPath } = await loadSentry();

    const result = stripToPath(url);

    expect(result).toBe("/");
  });

  it.each([
    [`https:/${H}/x`],
    [`https:///${H}/x`],
    [`https:${H}/x`],
    [`https:\\\\${H}\\x`],
    ["HTTPS://LAPTOP.tail1234.ts.net/x"],
    [`/\\${H}/x`],
    [`/\t/${H}/x`],
  ])("TP-11.25 (A-500): stripToPath(%j) → /x, the parser's host dropped", async (url) => {
    const { stripToPath } = await loadSentry();

    expect(stripToPath(url)).toBe("/x");
  });

  it.each([
    ["/api/v1/things?q=x", "/api/v1/things"],
    ["https://h/a b", "/a%20b"],
    ["https://h/a/../b", "/b"],
  ])("TP-11.25 (A-500): stripToPath(%j) → %s", async (url, expected) => {
    const { stripToPath } = await loadSentry();

    expect(stripToPath(url)).toBe(expected);
  });

  it("TP-11.25 (A-500): no stripToPath result contains ts.net, the canary or its base64", async () => {
    const { stripToPath } = await loadSentry();
    const inputs = [
      `data:/,${CANARY}`,
      `data:/;base64,${B64}`,
      `data://h/,${CANARY}`,
      `DATA:/,${CANARY}`,
      `javascript:/${CANARY}`,
      `blob:data:/,${CANARY}`,
      `https:/${H}/x`,
      `https:///${H}/x`,
      `https:${H}/x`,
      `https:\\\\${H}\\x`,
      "HTTPS://LAPTOP.tail1234.ts.net/x",
      `/\\${H}/x`,
      `/\t/${H}/x`,
    ];

    for (const url of inputs) {
      const result = stripToPath(url);
      for (const banned of ["ts.net", CANARY, B64]) {
        expect(result, `${JSON.stringify(url)} → ${result}`).not.toContain(banned);
      }
    }
  });

  it("TP-11.25 (A-500): a fetch crumb with data.url data:/,<canary> keeps url exactly /", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    const kept = scrubWebBreadcrumb({
      category: "fetch",
      data: { method: "GET", url: `data:/,${CANARY}` },
    });

    expect((kept as { data?: { url?: unknown } } | null)?.data?.url).toBe("/");
    expect(JSON.stringify(kept)).not.toContain(CANARY);
  });

  it("TP-11.25 (A-500): an xhr crumb with https:///H/api/v1/things?q=<canary> keeps url exactly /api/v1/things", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    const kept = scrubWebBreadcrumb({
      category: "xhr",
      data: { method: "GET", url: `https:///${H}/api/v1/things?q=${CANARY}` },
    });

    expect((kept as { data?: { url?: unknown } } | null)?.data?.url).toBe("/api/v1/things");
    const text = JSON.stringify(kept);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("ts.net");
  });
});

describe("TP-11.25 (A-500): the route tag keeps a path only when the parser agrees", () => {
  it("TP-11.25 (A-500): route /things/{id} stays /things/{id}", async () => {
    const { scrubWebEvent } = await loadSentry();

    expect(scrubWebEvent({ tags: { route: "/things/{id}" } })?.["tags"]).toEqual({
      route: "/things/{id}",
    });
  });

  it.each([[`data:/${CANARY}`], ["javascript:/x"], [`https:/${H}/x`], [`https:///${H}/x`]])(
    "TP-11.25 (A-500): route %j gives no route tag",
    async (route) => {
      const { scrubWebEvent } = await loadSentry();

      const scrubbed = scrubWebEvent({ tags: { route } });

      const tags = (scrubbed?.["tags"] ?? {}) as Record<string, unknown>;
      expect(Object.keys(tags)).not.toContain("route");
      const text = JSON.stringify(scrubbed);
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain("ts.net");
    },
  );
});

// ---- A-500 (4), review N-2: the crumb data allow-list ----

describe("TP-11.25 (A-500 (4)): a fetch crumb keeps a valid method and a numeric status_code, each on its own", () => {
  const base = {
    url: "https://budmon.example/api/v1/things",
    method: "GET",
    status_code: 200,
    note: CANARY,
  };

  it.each([
    ["(m0) nothing changed", {}, ["url", "method", "status_code"]],
    ["(m1) method get", { method: "get" }, ["url", "status_code"]],
    ["(m2) method GET <canary>", { method: `GET ${CANARY}` }, ["url", "status_code"]],
    ['(m3) status_code "200"', { status_code: "200" }, ["url", "method"]],
  ] as const)(
    "TP-11.25 (A-500 (4)): %s keeps only its valid data keys",
    async (_label, change, keys) => {
      const { scrubWebBreadcrumb } = await loadSentry();

      const kept = scrubWebBreadcrumb({ category: "fetch", data: { ...base, ...change } });

      expect(kept).not.toBeNull();
      const data: Record<string, unknown> =
        (kept as { data?: Record<string, unknown> } | null)?.data ?? {};
      const expected: readonly string[] = keys;
      expect(Object.keys(data).sort()).toEqual([...expected].sort());
      expect(data["url"]).toBe("/api/v1/things");
      if (expected.includes("method")) expect(data["method"]).toBe("GET");
      if (expected.includes("status_code")) expect(data["status_code"]).toBe(200);
      expect(JSON.stringify(kept)).not.toContain(CANARY);
    },
  );
});

// ---- A-501 (1), G-1 and N-1: the route tag is exactly the parser's path and never starts with // ----

describe("TP-11.25 (A-501 (1)): the route tag is the parser's path, not a re-parsed reduction", () => {
  it.each([
    ["(r1)", `https:////${H}/x`],
    ["(r2)", `////${H}/x`],
    ["(r3)", `HTTPS:////${H}`],
    ["(r4)", `blob:https:////${H}/x`],
    ["(r5)", "data:////"],
    ["(r6)", `https:/${H}/../x`],
    ["(r7)", `/${H}/../x`],
    ["(r8)", `https:/${H}/..`],
    ["(r9)", "https://h/a/../b"],
    ["(r10)", "/a/./b"],
    ["(r11)", "https://h//x"],
  ])("TP-11.25 (A-501): %s route %j gives no route tag", async (_label, route) => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ tags: { route, custom: CANARY } });

    const tags = (scrubbed?.["tags"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(tags)).not.toContain("route");
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain("ts.net");
    expect(text).not.toContain(CANARY);
  });

  it.each([
    [`//${H}/x`, "/x"],
    ["/a//b", "/a//b"],
  ])("TP-11.25 (A-501): route %j → tags exactly { route: %j }", async (route, expected) => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({ tags: { route } });

    expect(scrubbed?.["tags"]).toStrictEqual({ route: expected });
    expect(JSON.stringify(scrubbed)).not.toContain("ts.net");
  });

  it.each([
    ["/things/{id}"],
    ["/things"],
    ["/"],
    ["/x"],
    ["/a//b"],
    // A-501 re-review N-1: two brace pairs, so every { and } must be matched, not just the first.
    ["/things/{id}/items/{itemId}"],
    // A-501 (1)'s "Unchanged" list.
    ["/things/*"],
  ])("TP-11.25 (A-501): a kept route tag %j scrubbed again comes back unchanged", async (route) => {
    const { scrubWebEvent } = await loadSentry();

    expect(scrubWebEvent({ tags: { route } })?.["tags"]).toStrictEqual({ route });
  });

  it("TP-11.25 (A-501): a full URL with two brace pairs keeps exactly its template path", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({
      tags: { route: "https://budmon.example/things/{id}/items/{itemId}?q=x" },
    });

    expect(scrubbed?.["tags"]).toStrictEqual({ route: "/things/{id}/items/{itemId}" });
  });
});

// ---- A-502 (12): condition (iii) decodes the parser's brace escapes ----

/** A URL class whose pathname leaves { and } raw, as a parser that doesn't encode them would. */
function rawBraceURL(): typeof URL {
  const Real = globalThis.URL;
  class RawBraceURL extends Real {}
  Object.defineProperty(RawBraceURL.prototype, "pathname", {
    configurable: true,
    get(this: URL): string {
      // The real getter, wherever it sits on the prototype chain, with this instance.
      const value: string = Reflect.get(Real.prototype, "pathname", this);
      return value.replace(/%7B/g, "{").replace(/%7D/g, "}");
    },
  });
  return RawBraceURL;
}

describe("TP-11.25 (A-502 (12)): the route tag holds with a parser that leaves braces raw", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TP-11.25 (A-502): the stub really leaves braces raw", () => {
    vi.stubGlobal("URL", rawBraceURL());

    expect(new URL("https://h/things/{id}").pathname).toBe("/things/{id}");
  });

  it.each([
    ["/things/{id}", "/things/{id}"],
    ["https://budmon.example/things/{id}/items/{itemId}?q=x", "/things/{id}/items/{itemId}"],
  ])("TP-11.25 (A-502): with raw braces, route %j → %j", async (route, expected) => {
    const { scrubWebEvent } = await loadSentry();
    vi.stubGlobal("URL", rawBraceURL());

    expect(scrubWebEvent({ tags: { route } })?.["tags"]).toStrictEqual({ route: expected });
  });

  it.each([
    ["(r1)", `https:////${H}/x`],
    ["(r2)", `////${H}/x`],
    ["(r3)", `HTTPS:////${H}`],
    ["(r4)", `blob:https:////${H}/x`],
    ["(r5)", "data:////"],
    ["(r6)", `https:/${H}/../x`],
    ["(r7)", `/${H}/../x`],
    ["(r8)", `https:/${H}/..`],
    ["(r9)", "https://h/a/../b"],
    ["(r10)", "/a/./b"],
    ["(r11)", "https://h//x"],
  ])(
    "TP-11.25 (A-502): with raw braces, %s route %j still gives no route tag",
    async (_l, route) => {
      const { scrubWebEvent } = await loadSentry();
      vi.stubGlobal("URL", rawBraceURL());

      const scrubbed = scrubWebEvent({ tags: { route, custom: CANARY } });

      const tags = (scrubbed?.["tags"] ?? {}) as Record<string, unknown>;
      expect(Object.keys(tags)).not.toContain("route");
      expect(JSON.stringify(scrubbed)).not.toContain("ts.net");
    },
  );

  it("TP-11.25 (A-502): with the real parser, /{a}{b} is kept and /things/%7Bid%7D gets no route tag", async () => {
    const { scrubWebEvent } = await loadSentry();

    expect(scrubWebEvent({ tags: { route: "/{a}{b}" } })?.["tags"]).toStrictEqual({
      route: "/{a}{b}",
    });
    const encoded = scrubWebEvent({ tags: { route: "/things/%7Bid%7D" } });
    expect(Object.keys((encoded?.["tags"] ?? {}) as Record<string, unknown>)).not.toContain(
      "route",
    );
  });
});

// ---- A-501 (3), N-2: a kept crumb's timestamp, type and level are value-checked ----

describe("TP-11.25 (A-501 (3)): crumb timestamp, type and level are kept only when valid", () => {
  const base = { category: "fetch", data: { url: "https://budmon.example/api/v1/things" } };
  const DATA = { url: "/api/v1/things" };
  const clean = (r: unknown) => {
    const text = JSON.stringify(r);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("ts.net");
  };

  it("TP-11.25 (A-501): (t0) valid type, level and timestamp are kept exactly", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    const r = scrubWebBreadcrumb({
      ...base,
      type: "http",
      level: "warning",
      timestamp: 1761379200.123,
    });

    expect(r).toStrictEqual({
      category: "fetch",
      type: "http",
      level: "warning",
      timestamp: 1761379200.123,
      data: DATA,
    });
  });

  it.each([
    ["(t1)", { type: { secret: CANARY }, level: CANARY, timestamp: CANARY }],
    ["(t2)", { type: CANARY, level: H, timestamp: "1761379200" }],
  ])(
    "TP-11.25 (A-501): %s invalid type, level and timestamp are all dropped",
    async (_l, extra) => {
      const { scrubWebBreadcrumb } = await loadSentry();

      const r = scrubWebBreadcrumb({ ...base, ...extra });

      expect(r).toStrictEqual({ category: "fetch", data: DATA });
      clean(r);
    },
  );

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])(
    "TP-11.25 (A-501): (t3) timestamp %s is dropped",
    async (timestamp) => {
      const { scrubWebBreadcrumb } = await loadSentry();

      const r = scrubWebBreadcrumb({ ...base, timestamp });

      expect(Object.keys(r ?? {})).not.toContain("timestamp");
    },
  );

  it("TP-11.25 (A-501): (t4) type HTTP and level Warning (wrong case) are dropped", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    const r = scrubWebBreadcrumb({ ...base, type: "HTTP", level: "Warning" });

    expect(Object.keys(r ?? {})).not.toContain("type");
    expect(Object.keys(r ?? {})).not.toContain("level");
  });

  it("TP-11.25 (A-501): (t5) an invalid level is dropped on its own", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    const r = scrubWebBreadcrumb({ ...base, type: "http", level: CANARY, timestamp: 1761379200 });

    expect(Object.keys(r ?? {}).sort()).toEqual(["category", "data", "timestamp", "type"]);
    clean(r);
  });

  it("TP-11.25 (A-501): (t6) an xhr crumb keeps level log; a navigation crumb keeps type navigation and its paths", async () => {
    const { scrubWebBreadcrumb } = await loadSentry();

    expect(scrubWebBreadcrumb({ ...base, category: "xhr", level: "log" })?.["level"]).toBe("log");
    const nav = scrubWebBreadcrumb({
      category: "navigation",
      type: "navigation",
      data: { from: `/a?q=${CANARY}`, to: "/b" },
    });
    expect(nav).toStrictEqual({
      category: "navigation",
      type: "navigation",
      data: { from: "/a", to: "/b" },
    });
    clean(nav);
  });

  it("TP-11.25 (A-501): scrubWebEvent with the (t1) crumb gives exactly its scrubbed form", async () => {
    const { scrubWebEvent } = await loadSentry();

    const scrubbed = scrubWebEvent({
      breadcrumbs: [{ ...base, type: { secret: CANARY }, level: CANARY, timestamp: CANARY }],
    });

    expect(scrubbed?.["breadcrumbs"]).toStrictEqual([{ category: "fetch", data: DATA }]);
    clean(scrubbed);
  });
});
