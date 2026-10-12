// F-34 initSentry and F-35's scrubbers: the only fields that may reach Sentry.
import * as Sentry from "@sentry/node";
import { isValidSentryDsn, type AppEnv } from "../config/schema.js";
import { buildReportEvent, type ErrorReporter } from "./errorReporter.js";
import { isUuid } from "@budmon/shared";
import { ERROR_KEY, isRoute, JOB_NAME, REQUEST_ID, TOKEN } from "./safeFields.js";
import {
  buildErrorEvent,
  FRAME_FILENAME,
  FRAME_FUNCTION,
  reduceFilename,
  stripPathQuery,
  stripQuery,
} from "./sanitize.js";

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function pick(source: Json | undefined, keys: readonly string[]): Json {
  const out: Json = {};
  if (source === undefined) return out;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const EVENT_KEYS = ["event_id", "timestamp", "platform", "level", "release", "environment"];
const FRAME_KEYS = ["filename", "function", "lineno", "colno", "in_app"];
function withReducedFilename(frame: Json): Json {
  const filename = frame["filename"];
  return typeof filename === "string" ? { ...frame, filename: reduceFilename(filename) } : frame;
}

/** A frame survives only when its parts pass A-110's patterns. */
function frameIsSafe(frame: Json): boolean {
  const fn = frame["function"];
  const filename = frame["filename"];
  return (
    (fn === undefined || (typeof fn === "string" && FRAME_FUNCTION.test(fn))) &&
    typeof filename === "string" &&
    FRAME_FILENAME.test(filename) &&
    (frame["lineno"] === undefined || typeof frame["lineno"] === "number") &&
    (frame["colno"] === undefined || typeof frame["colno"] === "number")
  );
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const SYSTEM_CODE = /^E[A-Z0-9_]{1,30}$/;

/** An integer 100..599, as a number or (as Sentry tags are sent) its decimal string. */
function isHttpStatus(value: unknown): boolean {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-5]\d\d$/.test(value)
        ? Number.parseInt(value, 10) // three digits, checked above
        : Number.NaN;
  return Number.isInteger(n) && n >= 100 && n <= 599;
}

/** Tags restricted to their keys and F-30's rules; failing values are dropped (A-112). */
function checkedTags(tags: Json | undefined): Json {
  const out: Json = {};
  if (tags === undefined) return out;
  const route = tags["route"];
  if (typeof route === "string" && isRoute(stripPathQuery(route))) {
    out["route"] = stripPathQuery(route);
  }
  const job = tags["job"];
  if (typeof job === "string" && JOB_NAME.test(job)) out["job"] = job;
  const clientKind = tags["client_kind"];
  if (typeof clientKind === "string" && TOKEN.test(clientKind)) out["client_kind"] = clientKind;
  const requestId = tags["request_id"];
  if (typeof requestId === "string" && REQUEST_ID.test(requestId)) out["request_id"] = requestId;
  const errorKey = tags["error_key"];
  if (typeof errorKey === "string" && ERROR_KEY.test(errorKey)) out["error_key"] = errorKey;
  // A-137.
  const errorCode = tags["error_code"];
  if (typeof errorCode === "string" && (SQLSTATE.test(errorCode) || SYSTEM_CODE.test(errorCode))) {
    out["error_code"] = errorCode;
  }
  const httpStatus = tags["http_status"];
  if (isHttpStatus(httpStatus)) out["http_status"] = httpStatus;
  return out;
}

export function scrubBreadcrumb(b: Record<string, unknown>): Record<string, unknown> | null {
  const category = b["category"];
  if (category !== "http" && category !== "navigation") return null;
  const out: Json = { category, ...pick(b, ["timestamp", "type", "level"]) };
  const data = record(b["data"]);
  if (data !== undefined) {
    const kept: Json = {};
    if (typeof data["url"] === "string") kept["url"] = stripQuery(data["url"]);
    if (data["method"] !== undefined) kept["method"] = data["method"];
    if (data["status_code"] !== undefined) kept["status_code"] = data["status_code"];
    out["data"] = kept;
  }
  return out;
}

export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  const out: Json = pick(event, EVENT_KEYS);

  const exception = record(event["exception"]);
  const values = exception?.["values"];
  if (Array.isArray(values)) {
    out["exception"] = {
      values: values.map((raw: unknown) => {
        const entry = record(raw) ?? {};
        const type = entry["type"];
        const value = entry["value"];
        // Every value becomes its type, except an API error key (A-101).
        const kept: Json = {
          ...(type === undefined ? {} : { type }),
          value: typeof value === "string" && ERROR_KEY.test(value) ? value : type,
        };
        const frames = record(entry["stacktrace"])?.["frames"];
        if (Array.isArray(frames)) {
          kept["stacktrace"] = {
            frames: frames
              .map((f: unknown) => withReducedFilename(pick(record(f), FRAME_KEYS)))
              .filter((f) => frameIsSafe(f)),
          };
        }
        return kept;
      }),
    };
  }

  const tags = checkedTags(record(event["tags"]));
  if (Object.keys(tags).length > 0) out["tags"] = tags;

  const userId = record(event["user"])?.["id"];
  if (typeof userId === "string" && isUuid(userId)) out["user"] = { id: userId };

  const trace = record(record(event["contexts"])?.["trace"]);
  if (trace !== undefined) out["contexts"] = { trace: pick(trace, ["trace_id", "span_id"]) };

  // A-134: Sentry 11 sends an array; `{ values: [] }` is accepted defensively. Always an array.
  const rawCrumbs = event["breadcrumbs"];
  const crumbs = Array.isArray(rawCrumbs) ? rawCrumbs : record(rawCrumbs)?.["values"];
  if (rawCrumbs !== undefined) {
    out["breadcrumbs"] = Array.isArray(crumbs)
      ? crumbs
          .map((c: unknown) => scrubBreadcrumb(record(c) ?? {}))
          .filter((c): c is Json => c !== null)
      : [];
  }
  return out;
}

export function initSentry(cfg: {
  dsn?: string;
  environment: AppEnv;
  release: string;
  service: string;
  httpsProxy?: string;
}): ErrorReporter {
  // A-131: an invalid DSN never reaches Sentry.init, which would print it with its key.
  if (cfg.dsn === undefined || !isValidSentryDsn(cfg.dsn, cfg.environment)) {
    return { report: () => undefined, flush: () => Promise.resolve() };
  }
  const client = Sentry.init({
    dsn: cfg.dsn,
    // A-131: Sentry's console stays silent; its internal logger is never enabled.
    debug: false,
    environment: cfg.environment,
    release: cfg.release,
    // Sentry 11's form of `sendDefaultPii: false`: collect nothing about users, requests or
    // frames beyond what the event built from F-33 carries.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    includeLocalVariables: false,
    maxBreadcrumbs: 20,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    integrations: [
      Sentry.linkedErrorsIntegration({ limit: 1 }),
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
      Sentry.onUnhandledRejectionIntegration({ mode: "none" }),
    ],
    beforeSend: (event, hint) => {
      // Events Sentry built itself (uncaught exceptions, unhandled rejections) carry frames parsed
      // from err.stack, which can hold message text. Their exception is rebuilt from the original
      // error through F-33, so Sentry's own parsing is never used (B-1).
      const raw = event as unknown as Json;
      const values = record(raw["exception"])?.["values"];
      const exception =
        hint.originalException !== undefined
          ? { values: [buildErrorEvent(hint.originalException)] }
          : {
              values: Array.isArray(values)
                ? values.map((v: unknown) => pick(record(v), ["type"]))
                : [],
            };
      const source = { ...raw, exception };
      return scrubSentryEvent(source) as unknown as typeof event;
    },
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as unknown as Json),
    ...(cfg.httpsProxy === undefined ? {} : { transportOptions: { proxy: cfg.httpsProxy } }),
  });
  return {
    report(err, ctx) {
      // The original error object never reaches Sentry: only the event built from F-33.
      // The hint lets beforeSend rebuild the exception from the error, as for Sentry's own events.
      try {
        client?.captureEvent(buildReportEvent(err, ctx), { originalException: err });
      } catch {
        // `report` never throws (A-132).
      }
    },
    async flush(timeoutMs) {
      await client?.flush(timeoutMs);
    },
  };
}
