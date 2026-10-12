// F-34: the error reporter interface, the report event, and the in-memory reporter for tests and
// the canary suite.
import { isUuid } from "@budmon/shared";
import { ERROR_KEY, isRoute, JOB_NAME, REQUEST_ID } from "./safeFields.js";
import { buildErrorEvent, sanitizeError, stripPathQuery } from "./sanitize.js";
import { scrubSentryEvent } from "./sentry.js";

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  route?: string;
  jobName?: string;
  errorKey?: string;
}

export interface ErrorReporter {
  report(err: unknown, ctx: ErrorContext): void;
  flush(timeoutMs: number): Promise<void>;
}

function valid(value: unknown, rule: RegExp): string | undefined {
  return typeof value === "string" && rule.test(value) ? value : undefined;
}

/** A context property read that never throws: a throwing getter counts as absent (A-132). */
function read(ctx: ErrorContext, key: keyof ErrorContext): unknown {
  try {
    return (ctx as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** The context values that pass F-30's rules; a failing value is dropped (A-112). */
export function checkedContext(ctx: ErrorContext): ErrorContext {
  const rawRoute = read(ctx, "route");
  const strippedRoute = typeof rawRoute === "string" ? stripPathQuery(rawRoute) : undefined;
  const route = isRoute(strippedRoute) ? strippedRoute : undefined;
  const checked: ErrorContext = {};
  const requestId = valid(read(ctx, "requestId"), REQUEST_ID);
  const rawUserId = read(ctx, "userId");
  const userId = typeof rawUserId === "string" && isUuid(rawUserId) ? rawUserId : undefined;
  const jobName = valid(read(ctx, "jobName"), JOB_NAME);
  const errorKey = valid(read(ctx, "errorKey"), ERROR_KEY);
  if (requestId !== undefined) checked.requestId = requestId;
  if (userId !== undefined) checked.userId = userId;
  if (route !== undefined) checked.route = route;
  if (jobName !== undefined) checked.jobName = jobName;
  if (errorKey !== undefined) checked.errorKey = errorKey;
  return checked;
}

/** The Sentry event for a report: built from F-33's parts and the checked context only, never
 * from the error object itself. */
export function buildReportEvent(err: unknown, ctx: ErrorContext): Record<string, unknown> {
  const checked = checkedContext(ctx);
  const tags: Record<string, string> = {};
  if (checked.route !== undefined) tags["route"] = checked.route;
  if (checked.jobName !== undefined) tags["job"] = checked.jobName;
  if (checked.errorKey !== undefined) tags["error_key"] = checked.errorKey;
  if (checked.requestId !== undefined) tags["request_id"] = checked.requestId;
  // A-137: F-33's code and status, already safe by format.
  const sanitized = sanitizeError(err);
  if (sanitized.code !== undefined) tags["error_code"] = sanitized.code;
  if (sanitized.status !== undefined) tags["http_status"] = String(sanitized.status);
  return {
    level: "error",
    exception: { values: [buildErrorEvent(err)] },
    tags,
    ...(checked.userId === undefined ? {} : { user: { id: checked.userId } }),
  };
}

export function createMemoryErrorReporter(): ErrorReporter & {
  readonly events: readonly Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    report(err, ctx) {
      try {
        const event = scrubSentryEvent(buildReportEvent(err, ctx));
        if (event !== null) events.push(event);
      } catch {
        // `report` never throws (A-132).
      }
    },
    flush: () => Promise.resolve(),
  };
}
