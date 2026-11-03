// F-40 AllowlistSpanExporter. TP-3.7 and TP-3.16 (links, A-114), plus extra cases TP-3.26x
// (classification by prefix, the allowlist itself, status messages, delegation), TP-3.33x (link
// attributes) and TP-3.35x (pg.query renames, A-237). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { SpanKind, SpanStatusCode, type Attributes } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import {
  AllowlistSpanExporter,
  EXPECTED_DROPPED_SPAN_ATTRIBUTES,
  SPAN_ATTRIBUTE_ALLOWLIST,
} from "../../../src/platform/observability/otel.js";
import { RecordingSpanExporter } from "../../support/telemetry.js";

/** F-40's allowlist (A-176: url.path out, budmon.route in; A-177: server.* on non-SERVER spans). */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "budmon.route",
  "url.scheme",
  "server.address",
  "server.port",
  "network.protocol.version",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "db.collection.name",
  "db.query.text",
  "rpc.system",
  "rpc.method",
  "budmon.job.name",
  "budmon.queue",
  "budmon.error.key",
  "budmon.outcome",
  "budmon.client.kind",
]);

interface SpanSpec {
  attributes: Attributes;
  kind?: SpanKind;
  links?: { traceId: string; spanId: string; attributes: Attributes }[];
  events?: { name: string; attributes?: Attributes }[];
  exception?: Error;
  statusMessage?: string;
}

/** Real finished spans from the SDK, collected by an in-memory exporter. */
function makeSpans(
  specs: readonly SpanSpec[],
  name = "GET /a/{id}",
  scope = "test",
): ReadableSpan[] {
  const source = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(source)] });
  const tracer = provider.getTracer(scope);
  for (const spec of specs) {
    const span = tracer.startSpan(name, {
      attributes: spec.attributes,
      ...(spec.kind === undefined ? {} : { kind: spec.kind }),
      links: (spec.links ?? []).map((l) => ({
        context: { traceId: l.traceId, spanId: l.spanId, traceFlags: 1 },
        attributes: l.attributes,
      })),
    });
    if (spec.exception !== undefined) span.recordException(spec.exception);
    for (const event of spec.events ?? []) span.addEvent(event.name, event.attributes);
    if (spec.statusMessage !== undefined) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: spec.statusMessage });
    }
    span.end();
  }
  return source.getFinishedSpans();
}

function exportThrough(spans: ReadableSpan[], allowlist: ReadonlySet<string> = ALLOWLIST) {
  const inner = new RecordingSpanExporter();
  const onDrop = vi.fn<(kind: "expected" | "unexpected", n: number) => void>();
  const exporter = new AllowlistSpanExporter(inner, allowlist, onDrop);
  const results: unknown[] = [];
  exporter.export(spans, (result: unknown) => results.push(result));
  const sums = { expected: 0, unexpected: 0 };
  for (const [kind, n] of onDrop.mock.calls) sums[kind] += n;
  return { inner, onDrop, sums, results, exporter };
}

describe("TP-3.7: AllowlistSpanExporter", () => {
  function tp37Span(): ReadableSpan[] {
    return makeSpans([
      {
        attributes: {
          "http.route": "/a/{id}",
          "url.full": `https://x.io/a/1?token=${CANARIES.token}`,
          "http.request.header.cookie": [`sid=${CANARIES.token}`],
          "user.email": CANARIES.email,
        },
        exception: new Error(CANARIES.message),
        events: [{ name: "custom", attributes: { payee: CANARIES.payee } }],
      },
    ]);
  }

  it("TP-3.7: the exported span keeps http.route only, and no events", () => {
    const { inner } = exportThrough(tp37Span());

    expect(inner.spans).toHaveLength(1);
    expect(inner.spans[0]?.attributes).toEqual({ "http.route": "/a/{id}" });
    expect(inner.spans[0]?.events).toEqual([]);
  });

  it('TP-3.7: onDrop("expected", 3) for url.full, the header and the exception event', () => {
    const { onDrop, sums } = exportThrough(tp37Span());

    expect(onDrop).toHaveBeenCalledWith("expected", 3);
    expect(sums.expected).toBe(3);
  });

  it('TP-3.7: onDrop("unexpected", 2) for user.email and the custom event', () => {
    const { onDrop, sums } = exportThrough(tp37Span());

    expect(onDrop).toHaveBeenCalledWith("unexpected", 2);
    expect(sums.unexpected).toBe(2);
  });

  it("TP-3.7: nothing exported carries a canary", () => {
    const { inner } = exportThrough(tp37Span());

    const text = JSON.stringify(
      inner.spans.map((s) => ({ attributes: s.attributes, events: s.events, status: s.status })),
    );
    expect(scanForCanaries([{ name: "spans", text }], CANARIES)).toEqual([]);
  });
});

describe("TP-3.26x: AllowlistSpanExporter, further cases (F-40)", () => {
  it("TP-3.26x: every allowlisted attribute is kept", () => {
    // budmon.route must pass F-30's route rule (A-176), so it gets a template.
    const attributes = Object.fromEntries(
      [...ALLOWLIST].map((key) => [key, key === "budmon.route" ? "/a/{id}" : "v"]),
    );
    const { inner, sums } = exportThrough(makeSpans([{ attributes }]));

    expect(inner.spans[0]?.attributes).toEqual(attributes);
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it.each([
    ["an exact entry", "client.address"],
    ["a prefix entry (net.)", "net.peer.name"],
    ["a prefix entry (db.postgresql.)", "db.postgresql.plan"],
    ["a prefix entry (http.response.header.)", "http.response.header.set_cookie"],
    ["a prefix entry (exception.)", "exception.message"],
  ])("TP-3.26x: %s (%s) is an expected drop", (_label, key) => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: { [key]: "x" } }]));

    expect(inner.spans[0]?.attributes).toEqual({});
    expect(sums).toEqual({ expected: 1, unexpected: 0 });
  });

  it.each([
    ["a key only sharing a prefix without the dot", "netx"],
    ["a key extending an exact (non-dot) entry", "url.fullx"],
    ["an unknown budmon key", "budmon.payee"],
  ])("TP-3.26x: %s (%s) is an unexpected drop", (_label, key) => {
    const { sums } = exportThrough(makeSpans([{ attributes: { [key]: "x" } }]));

    expect(sums).toEqual({ expected: 0, unexpected: 1 });
  });

  it("TP-3.26x: the status message is cleared, the status code kept", () => {
    const { inner } = exportThrough(
      makeSpans([{ attributes: {}, statusMessage: `failed for ${CANARIES.email}` }]),
    );

    expect(inner.spans[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: "" });
  });

  it("TP-3.26x: the span name is left as is", () => {
    const { inner } = exportThrough(makeSpans([{ attributes: {} }]));

    expect(inner.spans[0]?.name).toBe("GET /a/{id}");
  });

  it("TP-3.26x: drops are summed across the spans of one export", () => {
    const spans = makeSpans([
      { attributes: { "url.full": "https://x.io/" } },
      { attributes: { "url.query": "a=1", "user.id": "u1" } },
    ]);

    const { sums } = exportThrough(spans);

    expect(sums).toEqual({ expected: 2, unexpected: 1 });
  });

  it("TP-3.26x: the inner exporter's result reaches the callback, and shutdown is delegated", async () => {
    const { results, inner, exporter } = exportThrough(makeSpans([{ attributes: {} }]));

    await exporter.shutdown();

    expect(results).toEqual([{ code: 0 }]);
    expect(inner.shutdowns).toBe(1);
  });

  it("TP-3.26x: EXPECTED_DROPPED_SPAN_ATTRIBUTES is F-40's list", () => {
    expect([...EXPECTED_DROPPED_SPAN_ATTRIBUTES].sort()).toEqual(
      [
        "url.full",
        "url.query",
        "url.original",
        "url.path", // A-176
        "user_agent.original",
        "client.address",
        "client.port",
        "network.peer.address",
        "network.peer.port",
        "network.local.address",
        "network.local.port",
        "network.transport",
        "network.type",
        "http.request.body.size",
        "http.response.body.size",
        "http.request.resend_count",
        "http.request.header.",
        "http.response.header.",
        "http.url",
        "http.target",
        "http.host",
        "http.scheme",
        "http.flavor",
        "http.user_agent",
        "http.method",
        "http.status_code",
        "http.client_ip",
        "net.",
        "db.user",
        "db.connection_string",
        "db.system",
        "db.name",
        "db.statement",
        "db.postgresql.",
        "messaging.",
        "pgboss.", // A-238
        "fastify.",
        "hook.",
        "service.name",
        "error.type",
        "exception.",
      ].sort(),
    );
  });
});

describe("TP-3.16: span links keep their context and lose their attributes (A-114)", () => {
  const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
  const SPAN_ID = "b7ad6b7169203331";

  it('TP-3.16: the exported link keeps trace and span ids, has no attributes, onDrop("unexpected", 1)', () => {
    const spans = makeSpans([
      {
        attributes: { "http.route": "/a/{id}" },
        links: [
          { traceId: TRACE_ID, spanId: SPAN_ID, attributes: { "user.email": CANARIES.email } },
        ],
      },
    ]);

    const { inner, onDrop, sums } = exportThrough(spans);

    const links = inner.spans[0]?.links ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]?.context).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID });
    expect(Object.keys(links[0]?.attributes ?? {})).toEqual([]);
    expect(onDrop).toHaveBeenCalledWith("unexpected", 1);
    expect(sums).toEqual({ expected: 0, unexpected: 1 });
    expect(scanForCanaries([{ name: "links", text: JSON.stringify(links) }], CANARIES)).toEqual([]);
  });

  it("TP-3.33x: a link attribute in EXPECTED_DROPPED_SPAN_ATTRIBUTES is an expected drop", () => {
    const spans = makeSpans([
      {
        attributes: {},
        links: [
          { traceId: TRACE_ID, spanId: SPAN_ID, attributes: { "url.full": "https://x.io/" } },
        ],
      },
    ]);

    expect(exportThrough(spans).sums).toEqual({ expected: 1, unexpected: 0 });
  });
});

describe("TP-3.7: query literals are masked and span names checked (A-135)", () => {
  function exportQuery(text: string) {
    return exportThrough(makeSpans([{ attributes: { "db.query.text": text } }]));
  }

  it("TP-3.7: quoted and numeric literals become ?, placeholders stay", () => {
    const { inner } = exportQuery(
      `SELECT * FROM t WHERE a = '${CANARIES.payee}' AND b = ${CANARIES.amountMinor} AND c = $1`,
    );

    expect(inner.spans[0]?.attributes["db.query.text"]).toBe(
      "SELECT * FROM t WHERE a = ? AND b = ? AND c = $1",
    );
  });

  it("TP-3.7: a dollar-quoted literal becomes ?", () => {
    const { inner } = exportQuery(`$q$${CANARIES.message}$q$`);

    expect(inner.spans[0]?.attributes["db.query.text"]).toBe("?");
  });

  it('TP-3.7: an unterminated quote drops the text with onDrop("unexpected", 1)', () => {
    const { inner, onDrop, sums } = exportQuery("SELECT 'abc");

    expect(inner.spans[0]?.attributes).not.toHaveProperty("db.query.text");
    expect(onDrop).toHaveBeenCalledWith("unexpected", 1);
    expect(sums.unexpected).toBe(1);
  });

  it("TP-3.7: a -- comment holding a canary is removed (A-142)", () => {
    const { inner } = exportQuery(`SELECT 1 -- ${CANARIES.payee}`);

    expect(inner.spans[0]?.attributes["db.query.text"]).toBe("SELECT ?");
  });

  it("TP-3.7: a /* */ comment holding a canary is removed; double-quoted identifiers stay (A-142)", () => {
    const { inner } = exportQuery(`SELECT /* ${CANARIES.message} */ "Payee" FROM t`);

    expect(inner.spans[0]?.attributes["db.query.text"]).toBe('SELECT "Payee" FROM t');
  });

  it("TP-3.7: an unterminated block comment drops the text, one unexpected (A-142)", () => {
    const { inner, sums } = exportQuery("SELECT /* open");

    expect(inner.spans[0]?.attributes).not.toHaveProperty("db.query.text");
    expect(sums.unexpected).toBe(1);
  });

  it("TP-3.7: span name GET /meta/client-config is kept", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: {} }], "GET /meta/client-config"),
    );

    expect(inner.spans[0]?.name).toBe("GET /meta/client-config");
    expect(sums.unexpected).toBe(0);
  });

  it("TP-3.7: span name 'pay Carrefour #3' becomes span with one unexpected drop", () => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: {} }], "pay Carrefour #3"));

    expect(inner.spans[0]?.name).toBe("span");
    expect(sums.unexpected).toBe(1);
  });

  it.each([
    ["E'' strings with doubled quotes", "SELECT E'it''s', 'a''b' FROM t", "SELECT ?, ? FROM t"],
    [
      "numbers inside identifiers stay",
      "SELECT col1, t2.x FROM t3 WHERE y = 1.5",
      "SELECT col1, t2.x FROM t3 WHERE y = ?",
    ],
    ["$10 is a placeholder", "SELECT $10, 42", "SELECT $10, ?"],
  ])("TP-3.26x: %s", (_label, text, expected) => {
    expect(exportQuery(text).inner.spans[0]?.attributes["db.query.text"]).toBe(expected);
  });
});

describe("TP-3.7: span names from instrumentations (A-164)", () => {
  it("TP-3.7: GET /api/v1/* is kept, with no drop", () => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: {} }], "GET /api/v1/*"));

    expect(inner.spans[0]?.name).toBe("GET /api/v1/*");
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it("TP-3.7: from scope @fastify/otel, 'onRequest - fastify -> @fastify/helmet' becomes onRequest, with no drop", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: {} }], "onRequest - fastify -> @fastify/helmet", "@fastify/otel"),
    );

    expect(inner.spans[0]?.name).toBe("onRequest");
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it("TP-3.7: the same name from another scope becomes span, with one unexpected drop", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: {} }], "onRequest - fastify -> @fastify/helmet", "other-scope"),
    );

    expect(inner.spans[0]?.name).toBe("span");
    expect(sums).toEqual({ expected: 0, unexpected: 1 });
  });

  it("TP-3.26x: @fastify/otel's request span keeps its name", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: {} }], "request", "@fastify/otel"),
    );

    expect(inner.spans[0]?.name).toBe("request");
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });
});

describe("TP-3.7: no raw path or client host in traces (A-176, A-177)", () => {
  const CANARY_PATH = `/api/v1/${CANARIES.payee}/${CANARIES.amountMinor}/${CANARIES.email}`;
  const CANARY_HOST = `${CANARIES.payee}.example.invalid`;

  it("TP-3.7: a SERVER span exports none of url.path, server.address, server.port (3 expected drops)", () => {
    const { inner, sums } = exportThrough(
      makeSpans([
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.route": "/api/v1/*",
            "url.path": CANARY_PATH,
            "server.address": CANARY_HOST,
            "server.port": 987654321,
          },
        },
      ]),
    );

    expect(inner.spans[0]?.attributes).toEqual({ "http.route": "/api/v1/*" });
    expect(sums).toEqual({ expected: 3, unexpected: 0 });
    const text = JSON.stringify(inner.spans.map((s) => s.attributes));
    expect(scanForCanaries([{ name: "spans", text }], CANARIES)).toEqual([]);
  });

  it("TP-3.7: a CLIENT span keeps server.address and server.port", () => {
    const { inner, sums } = exportThrough(
      makeSpans([
        {
          kind: SpanKind.CLIENT,
          attributes: { "server.address": "oauth2.googleapis.com", "server.port": 443 },
        },
      ]),
    );

    expect(inner.spans[0]?.attributes).toEqual({
      "server.address": "oauth2.googleapis.com",
      "server.port": 443,
    });
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it.each([
    ["CLIENT", SpanKind.CLIENT],
    ["INTERNAL", SpanKind.INTERNAL],
  ])("TP-3.7: url.path is dropped from a %s span too (expected)", (_label, kind) => {
    const { inner, sums } = exportThrough(
      makeSpans([{ kind, attributes: { "url.path": CANARY_PATH } }]),
    );

    expect(inner.spans[0]?.attributes).toEqual({});
    expect(sums).toEqual({ expected: 1, unexpected: 0 });
  });

  it("TP-3.7: budmon.route /payees/{id} is kept, with no drop", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: { "budmon.route": "/payees/{id}" } }]),
    );

    expect(inner.spans[0]?.attributes).toEqual({ "budmon.route": "/payees/{id}" });
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it("TP-3.7: budmon.route with a real id is dropped, one unexpected", () => {
    const { inner, sums } = exportThrough(
      makeSpans([
        { attributes: { "budmon.route": "/payees/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } },
      ]),
    );

    expect(inner.spans[0]?.attributes).toEqual({});
    expect(sums).toEqual({ expected: 0, unexpected: 1 });
  });

  it("TP-3.7: the test's allowlist is F-40's", () => {
    expect([...SPAN_ATTRIBUTE_ALLOWLIST].sort()).toEqual([...ALLOWLIST].sort());
  });
});

describe("TP-3.7: pg.query span names rewritten to keyword + database (A-237)", () => {
  const PG = "@opentelemetry/instrumentation-pg";

  it.each([
    ["a newline after the keyword", "pg.query:WITH\n budmon", "pg.query:WITH budmon"],
    [
      "a quote after the keyword",
      `pg.query:SELECT'${CANARIES.payee}' budmon`,
      "pg.query:SELECT budmon",
    ],
    [
      "a prepared statement name",
      `pg.query:GET-PAYEE-${CANARIES.payee.toUpperCase()} budmon`,
      "pg.query:OTHER budmon",
    ],
    [
      "a letters-only statement name (A-240)",
      "pg.query:CANARYPAYEE budmon",
      "pg.query:OTHER budmon",
    ],
    ["a token without leading letters (A-240)", "pg.query:1abc budmon", "pg.query:OTHER budmon"],
    ["an ordinary name", "pg.query:SELECT budmon", "pg.query:SELECT budmon"],
  ])("TP-3.7: %s: %j becomes %j, with no drop", (_label, name, expected) => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: {} }], name, PG));

    expect(inner.spans[0]?.name).toBe(expected);
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
    expect(
      scanForCanaries([{ name: "span name", text: inner.spans[0]?.name ?? "" }], CANARIES),
    ).toEqual([]);
  });

  it.each([["pg.connect"], ["pg-pool.connect"]])(
    "TP-3.7: %s is unchanged, with no drop",
    (name) => {
      const { inner, sums } = exportThrough(makeSpans([{ attributes: {} }], name, PG));

      expect(inner.spans[0]?.name).toBe(name);
      expect(sums).toEqual({ expected: 0, unexpected: 0 });
    },
  );

  it.each([
    ["a token with no leading letters", "pg.query:(SELECT budmon", "pg.query:OTHER budmon"],
    ["a database name outside [a-z0-9_]", "pg.query:SELECT Bad-DB", "pg.query:SELECT"],
    ["no database", "pg.query:INSERT", "pg.query:INSERT"],
    ["a lower-case keyword", "pg.query:select budmon", "pg.query:SELECT budmon"],
  ])("TP-3.35x: %s: %j becomes %j", (_label, name, expected) => {
    const { inner, sums } = exportThrough(makeSpans([{ attributes: {} }], name, PG));

    expect(inner.spans[0]?.name).toBe(expected);
    expect(sums).toEqual({ expected: 0, unexpected: 0 });
  });

  it("TP-3.35x: the same multi-line name from another scope still becomes span, with one unexpected drop", () => {
    const { inner, sums } = exportThrough(
      makeSpans([{ attributes: {} }], "pg.query:WITH\n budmon", "other-scope"),
    );

    expect(inner.spans[0]?.name).toBe("span");
    expect(sums).toEqual({ expected: 0, unexpected: 1 });
  });
});

describe("TP-3.7: pg-boss's own attributes are expected drops (A-238)", () => {
  it("TP-3.7: a span from scope pg-boss with pgboss.schema, pgboss.job.retry_count and pgboss.job.state drops all three as expected, none unexpected", () => {
    const { inner, sums } = exportThrough(
      makeSpans(
        [
          {
            attributes: {
              "pgboss.schema": "pgboss",
              "pgboss.job.retry_count": 1,
              "pgboss.job.state": "retry",
            },
          },
        ],
        "process test.ok",
        "pg-boss",
      ),
    );

    expect(inner.spans[0]?.attributes).toEqual({});
    expect(sums).toEqual({ expected: 3, unexpected: 0 });
  });
});
