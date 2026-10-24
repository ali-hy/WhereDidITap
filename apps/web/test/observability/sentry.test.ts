// F-217 web Sentry: init options and scrubbing. TP-11.25, plus extra cases TP-11.32x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    // F-217: stripped to the path, so no host.
    expect(url).toBe("/api/v1/things");
    expect(text).not.toContain("budmon.example");
    const values = (scrubbed?.["exception"] as { values?: { value?: string }[] } | undefined)
      ?.values;
    expect(values?.[0]?.value).toBe("TypeError");
  });

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
    expect(scrubbed["request"]).toEqual({ url: "https://budmon.example/api/v1/things" });
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
