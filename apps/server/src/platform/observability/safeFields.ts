// F-30: the closed set of fields a log line may carry, and their value rules.
export type FieldKind =
  "id" | "token" | "route" | "count" | "duration" | "bool" | "errorKey" | "date";

const kinds = (kind: FieldKind, names: readonly string[]): [string, FieldKind][] =>
  names.map((name) => [name, kind]);

export const SAFE_LOG_FIELDS = Object.freeze(
  Object.fromEntries([
    ...kinds("id", ["requestId", "traceId", "spanId", "userId", "entityId", "jobId"]),
    ...kinds("token", [
      "event",
      "step",
      "jobName",
      "queue",
      "method",
      "statusClass",
      "errorClass",
      "errorCode",
      "clientKind",
      "module",
      "outcome",
      "provider",
      "currency",
      "service",
      "release",
      "role",
      "limiter",
      "signal",
      "reason",
      "bucket",
    ]),
    ...kinds("route", ["route"]),
    ...kinds("count", [
      "status",
      "count",
      "attempt",
      "clientVersion",
      "dropped",
      "inserted",
      "rejected",
    ]),
    ...kinds("duration", ["durationMs"]),
    ...kinds("bool", ["retryable", "replayed", "provisional"]),
    ...kinds("errorKey", ["errorKey"]),
    ...kinds("date", ["rateDate"]),
  ]) as Readonly<Record<string, FieldKind>>,
);

export type SafeFieldName =
  | "requestId"
  | "traceId"
  | "spanId"
  | "userId"
  | "entityId"
  | "jobId"
  | "event"
  | "step"
  | "jobName"
  | "queue"
  | "method"
  | "statusClass"
  | "errorClass"
  | "errorCode"
  | "clientKind"
  | "module"
  | "outcome"
  | "provider"
  | "currency"
  | "service"
  | "release"
  | "role"
  | "limiter"
  | "signal"
  | "reason"
  | "bucket"
  | "route"
  | "status"
  | "count"
  | "attempt"
  | "clientVersion"
  | "dropped"
  | "inserted"
  | "rejected"
  | "durationMs"
  | "retryable"
  | "replayed"
  | "provisional"
  | "errorKey"
  | "rateDate";

export type SafeFields = Partial<Record<SafeFieldName, string | number | boolean>>;

export const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A-308: one trailing `/*` is allowed (a wildcard route's template, never the matched value). */
export const ROUTE = /^\/[A-Za-z0-9_./:{}-]{0,200}(\/\*)?$/;
const UUID_LIKE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const LONG_DIGITS = /\d{5}/;

/** F-30's `route` rule: the shape, and no segment that looks like a real id (A-136). Route values
 * are still code constants (A-116); this catches the common mistake of logging `request.url`. */
export function isRoute(value: unknown): value is string {
  if (typeof value !== "string" || !ROUTE.test(value)) return false;
  return value
    .split("/")
    .every((segment) => !UUID_LIKE.test(segment) && !LONG_DIGITS.test(segment));
}
/** A-121: request ids are trace ids (32 lower-case hex); job names are `<module>.<job>`. */
export const REQUEST_ID = /^[0-9a-f]{32}$/;
export const JOB_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const ERROR_KEY = /^[A-Z][A-Z0-9_]{1,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function valid(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "id":
    case "token":
      return typeof value === "string" && TOKEN.test(value);
    case "route":
      return isRoute(value);
    case "count":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "duration":
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    case "bool":
      return typeof value === "boolean";
    case "errorKey":
      return typeof value === "string" && ERROR_KEY.test(value);
    case "date":
      return typeof value === "string" && DATE.test(value);
  }
}

/** A field read that never throws: a throwing getter counts as a failed read (A-133). */
function readField(
  fields: Readonly<Record<string, unknown>>,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: fields[key] };
  } catch {
    return { ok: false };
  }
}

/** F-30 with the names of the dropped or replaced fields (A-139); `sanitizeFields` is the public
 * form. */
export function sanitizeFieldsWithKeys(fields: Readonly<Record<string, unknown>>): {
  fields: Record<string, string | number | boolean>;
  dropped: number;
  droppedKeys: string[];
} {
  const out: Record<string, string | number | boolean> = {};
  const droppedKeys: string[] = [];
  let dropped = 0;
  let keys: string[];
  try {
    keys = Object.keys(fields);
  } catch {
    return { fields: out, dropped: 1, droppedKeys };
  }
  for (const key of keys) {
    const kind = Object.hasOwn(SAFE_LOG_FIELDS, key) ? SAFE_LOG_FIELDS[key] : undefined;
    if (kind === undefined) {
      dropped += 1;
      droppedKeys.push(key);
      continue;
    }
    const read = readField(fields, key);
    if (!read.ok) {
      // A-133: dropped and counted, like an unknown key.
      dropped += 1;
      droppedKeys.push(key);
      continue;
    }
    if (valid(kind, read.value)) {
      out[key] = read.value as string | number | boolean;
    } else {
      out[key] = "[invalid]";
      dropped += 1;
      droppedKeys.push(key);
    }
  }
  return { fields: out, dropped, droppedKeys };
}

export function sanitizeFields(fields: Readonly<Record<string, unknown>>): {
  fields: Record<string, string | number | boolean>;
  dropped: number;
} {
  const { fields: out, dropped } = sanitizeFieldsWithKeys(fields);
  return { fields: out, dropped };
}
