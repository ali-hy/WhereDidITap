// F-36 startTelemetry and F-40 AllowlistSpanExporter: traces and metrics that carry only
// allowlisted attributes.
import { FastifyOtelInstrumentation } from "@fastify/otel";
import {
  ExportResultCode,
  W3CTraceContextPropagator,
  type ExportResult,
} from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { metrics as metricsApi, SpanKind, type Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  PeriodicExportingMetricReader,
  createAllowListAttributesProcessor,
  type MetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { AppEnv } from "../config/schema.js";
import type { Secret } from "./redaction.js";
import { createMetrics, METRIC_LABELS, type Metrics } from "./metrics.js";
import { isRoute } from "./safeFields.js";

/** What the pinned instrumentations emit beyond the allowlist (F-40). Entries ending in "." are
 * prefixes. */
export const EXPECTED_DROPPED_SPAN_ATTRIBUTES: readonly string[] = [
  "url.full",
  "url.query",
  "url.path",
  "url.original",
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
  // A-238: pg-boss's own span attributes.
  "pgboss.",
  "fastify.",
  "hook.",
  "service.name",
  "error.type",
  "exception.",
];

export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.response.status_code",
  "http.route",
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
  "budmon.route",
  "budmon.job.name",
  "budmon.queue",
  "budmon.error.key",
  "budmon.outcome",
  "budmon.client.kind",
]);

export const METRIC_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  ...METRIC_LABELS,
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
  "server.address",
  "server.port",
  "network.protocol.version",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "error.type",
];

/** A-135: the shape a span name must have to be exported. */
export const SPAN_NAME = /^[A-Za-z0-9_.:/{}* -]{1,120}$/;

const PG_DATABASE = /^[a-z0-9_]{1,63}$/;
/** A-240: SQL command keywords; anything else (a letters-only statement name) is OTHER. */
const PG_KEYWORDS: ReadonlySet<string> = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "WITH",
  "VALUES",
  "BEGIN",
  "START",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "SET",
  "RESET",
  "SHOW",
  "LOCK",
  "CREATE",
  "ALTER",
  "DROP",
  "GRANT",
  "REVOKE",
  "TRUNCATE",
  "ANALYZE",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "REFRESH",
  "COMMENT",
  "COPY",
  "DO",
  "CALL",
  "EXPLAIN",
  "LISTEN",
  "NOTIFY",
  "UNLISTEN",
  "DECLARE",
  "FETCH",
  "CLOSE",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
  "DISCARD",
]);

/**
 * A-237: `instrumentation-pg` names query spans `pg.query:<first token or statement name>
 * <database>`; the token can carry anything up to the first space (a newline, quoted text). The
 * name is rebuilt from safe parts only: the token's leading letters upper-cased when they are a
 * SQL keyword (else OTHER, A-240)
 * and the database when it has a plain name.
 */
function pgQueryName(name: string): string {
  const rest = name.startsWith("pg.query:") ? name.slice("pg.query:".length) : name.slice(8);
  const letters = /^[A-Za-z]+/.exec(rest)?.[0].toUpperCase();
  const keyword = letters !== undefined && PG_KEYWORDS.has(letters) ? letters : "OTHER";
  const space = rest.lastIndexOf(" ");
  const database = space === -1 ? "" : rest.slice(space + 1);
  return PG_DATABASE.test(database) ? `pg.query:${keyword} ${database}` : `pg.query:${keyword}`;
}

/** Deterministic rewrites of instrumentation-made names (no drop counted). */
function spanName(span: ReadableSpan): string {
  const scope = span.instrumentationScope.name;
  // A-164: `@fastify/otel` names hook spans `<hook> - <handler or plugin name>`; plugin names
  // have no bounded alphabet, so only the hook name is kept.
  if (scope === "@fastify/otel") {
    const separator = span.name.indexOf(" - ");
    return separator === -1 ? span.name : span.name.slice(0, separator);
  }
  if (scope === "@opentelemetry/instrumentation-pg" && span.name.startsWith("pg.query")) {
    return pgQueryName(span.name);
  }
  return span.name;
}

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-\uffff]/;
const DIGIT = /[0-9]/;
const NUMBER = /^(?:0[xXoObB][0-9A-Fa-f_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * A-135: `db.query.text` with every literal replaced by `?`: single-quoted strings (with doubled
 * quotes, and `E'…'` with backslash escapes), dollar-quoted strings and numeric literals that
 * aren't part of an identifier or a `$n` placeholder. Comments are removed, since they can hold
 * anything. Returns `null` when the quoting can't be parsed (an unterminated quote or comment).
 */
export function maskQueryText(text: string): string | null {
  let out = "";
  let i = 0;
  const n = text.length;
  /** The end of a single-quoted string starting at `start` (the quote), or -1. */
  const quoted = (start: number, backslashEscapes: boolean): number => {
    let j = start + 1;
    while (j < n) {
      const ch = text[j];
      if (backslashEscapes && ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "'") {
        if (text[j + 1] === "'") {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j += 1;
    }
    return -1;
  };
  /** A removed comment and the whitespace around it become one space (none at the end). */
  const joinAfterComment = (before: string): string => {
    while (i < n && /\s/.test(text[i] ?? "")) i += 1;
    const trimmed = before.trimEnd();
    return i < n && trimmed !== "" ? `${trimmed} ` : trimmed;
  };
  while (i < n) {
    const ch = text[i] ?? "";
    const next = text[i + 1];
    if (ch === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? n : end;
      out = joinAfterComment(out);
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
      out = joinAfterComment(out);
      continue;
    }
    if ((ch === "E" || ch === "e") && next === "'" && !IDENT_PART.test(text[i - 1] ?? " ")) {
      const end = quoted(i + 1, true);
      if (end === -1) return null;
      out += "?";
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = quoted(i, false);
      if (end === -1) return null;
      out += "?";
      i = end;
      continue;
    }
    if (ch === '"') {
      // A quoted identifier, kept as is.
      let j = i + 1;
      for (;;) {
        if (j >= n) return null;
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const placeholder = /^\$\d+/.exec(text.slice(i));
      if (placeholder !== null) {
        out += placeholder[0];
        i += placeholder[0].length;
        continue;
      }
      const tag = DOLLAR_TAG.exec(text.slice(i));
      if (tag !== null) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        if (end === -1) return null;
        out += "?";
        i = end + tag[0].length;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(text[j] ?? "")) j += 1;
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(next ?? ""))) {
      const number = NUMBER.exec(text.slice(i));
      const length = number === null ? 1 : number[0].length;
      out += "?";
      i += length;
      // A trailing identifier part (`1abc`) belongs to the literal too.
      while (i < n && IDENT_PART.test(text[i] ?? "")) i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function isExpectedDrop(key: string): boolean {
  return EXPECTED_DROPPED_SPAN_ATTRIBUTES.some((entry) =>
    entry.endsWith(".") ? key.startsWith(entry) : key === entry,
  );
}

export class AllowlistSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly allowlist: ReadonlySet<string>,
    private readonly onDrop: (kind: "expected" | "unexpected", n: number) => void,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    let expected = 0;
    let unexpected = 0;
    const filtered = spans.map((span): ReadableSpan => {
      const attributes: Attributes = {};
      for (const [key, value] of Object.entries(span.attributes)) {
        if (!this.allowlist.has(key)) {
          if (isExpectedDrop(key)) expected += 1;
          else unexpected += 1;
          continue;
        }
        // A-177: on SERVER spans these come from the client's Host header.
        if (span.kind === SpanKind.SERVER && (key === "server.address" || key === "server.port")) {
          expected += 1;
          continue;
        }
        // A-176: the route template, checked with F-30's route rule.
        if (key === "budmon.route") {
          if (isRoute(value)) attributes[key] = value;
          else unexpected += 1;
          continue;
        }
        if (key === "db.query.text") {
          const masked = typeof value === "string" ? maskQueryText(value) : null;
          if (masked === null) unexpected += 1;
          else attributes[key] = masked;
          continue;
        }
        attributes[key] = value;
      }
      let name = spanName(span);
      if (!SPAN_NAME.test(name)) {
        name = "span";
        unexpected += 1;
      }
      for (const event of span.events) {
        if (event.name === "exception") expected += 1;
        else unexpected += 1;
      }
      return {
        name,
        kind: span.kind,
        spanContext: () => span.spanContext(),
        ...(span.parentSpanContext === undefined
          ? {}
          : { parentSpanContext: span.parentSpanContext }),
        startTime: span.startTime,
        endTime: span.endTime,
        status: { code: span.status.code, message: "" },
        attributes,
        // Links keep their trace and span ids; their attributes go (A-114).
        links: span.links.map((link) => {
          for (const key of Object.keys(link.attributes ?? {})) {
            if (isExpectedDrop(key)) expected += 1;
            else unexpected += 1;
          }
          return { context: link.context };
        }),
        events: [],
        duration: span.duration,
        ended: span.ended,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
      };
    });
    if (expected > 0) this.onDrop("expected", expected);
    if (unexpected > 0) this.onDrop("unexpected", unexpected);
    this.inner.export(filtered, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/** A SpanExporter that drops everything (used only when nothing should leave the process). */
const noExport: SpanExporter = {
  export: (_spans, cb) => {
    cb({ code: ExportResultCode.SUCCESS });
  },
  shutdown: () => Promise.resolve(),
};

export function startTelemetry(
  cfg: {
    endpoint?: URL;
    /** A-138: sent with every OTLP export; only used with an endpoint. */
    headers?: Secret<Record<string, string>>;
    service: string;
    release: string;
    environment: AppEnv;
  },
  deps: {
    onDrop: (signal: "traces" | "metrics", kind: "expected" | "unexpected", n: number) => void;
    traceExporter?: SpanExporter;
    metricReader?: MetricReader;
  },
): { metrics: Metrics; shutdown(): Promise<void> } {
  // A-138: resolved against the endpoint with a trailing `/`, so a base path is kept.
  const base =
    cfg.endpoint === undefined
      ? undefined
      : new URL(cfg.endpoint.href.endsWith("/") ? cfg.endpoint.href : `${cfg.endpoint.href}/`);
  const headers = cfg.headers === undefined ? undefined : { ...cfg.headers.reveal() };
  const exporterOptions = (path: string): { url: string; headers?: Record<string, string> } => ({
    url: new URL(path, base).href,
    ...(headers === undefined ? {} : { headers }),
  });
  const innerTraceExporter =
    deps.traceExporter ??
    (base === undefined ? undefined : new OTLPTraceExporter(exporterOptions("v1/traces")));
  const metricReader =
    deps.metricReader ??
    (base === undefined
      ? undefined
      : new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(exporterOptions("v1/metrics")),
          exportIntervalMillis: 60_000,
        }));

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": cfg.service,
      "service.version": cfg.release,
      "deployment.environment.name": cfg.environment,
    }),
    // Nothing is configured from the environment: no detectors, no default exporters.
    autoDetectResources: false,
    resourceDetectors: [],
    spanProcessors:
      innerTraceExporter === undefined && deps.traceExporter === undefined
        ? []
        : [
            new BatchSpanProcessor(
              new AllowlistSpanExporter(
                innerTraceExporter ?? noExport,
                SPAN_ATTRIBUTE_ALLOWLIST,
                (kind, n) => {
                  deps.onDrop("traces", kind, n);
                },
              ),
            ),
          ],
    metricReaders: metricReader === undefined ? [] : [metricReader],
    logRecordProcessors: [],
    views: [
      {
        instrumentName: "*",
        attributesProcessors: [createAllowListAttributesProcessor([...METRIC_ATTRIBUTE_ALLOWLIST])],
      },
    ],
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => (req.url ?? "").startsWith("/health/"),
        headersToSpanAttributes: {
          client: { requestHeaders: [], responseHeaders: [] },
          server: { requestHeaders: [], responseHeaders: [] },
        },
      }),
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
      // @fastify/otel patches nothing through module hooks: it adds its plugin to each Fastify
      // instance from the `fastify.initialization` diagnostics channel, which needs this option.
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    ],
  });
  sdk.start();

  const metrics = createMetrics(metricsApi.getMeter("budmon"), (n) => {
    deps.onDrop("metrics", "unexpected", n);
  });
  return { metrics, shutdown: () => sdk.shutdown() };
}
