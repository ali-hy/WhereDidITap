// F-52: every error leaving a procedure becomes a platform envelope; unexpected ones are reported.
import { PLATFORM_ERRORS } from "@budmon/contract";
import { ValidationError } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import type { ErrorReporter } from "../observability/errorReporter.js";
import type { Logger } from "../observability/logger.js";
import { BudmonError } from "./BudmonError.js";
import type { Issue } from "./platformErrors.js";

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_type: "Invalid type",
  too_small: "Too small",
  too_big: "Too big",
  invalid_format: "Invalid format",
  invalid_value: "Invalid value",
  unrecognized_keys: "Unknown field",
  custom: "Invalid value",
};

const UNAVAILABLE_SQLSTATES = new Set(["57P01", "57P02", "57P03", "53300"]);
const UNAVAILABLE_SYSTEM_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"]);

function errorCode(err: unknown): unknown {
  return typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
}

/** Issues with fixed messages: never the input values zod quotes in its own (F-52 rule 2). */
function issuesOf(cause: ValidationError): Issue[] {
  return cause.issues.map((issue) => {
    const code = (issue as { code?: unknown }).code;
    const codeText = typeof code === "string" ? code : "custom";
    return {
      path: (issue.path ?? []).map((segment) => {
        const key = typeof segment === "object" && "key" in segment ? segment.key : segment;
        return typeof key === "number" ? key : String(key);
      }),
      code: codeText,
      message: ISSUE_MESSAGES[codeText] ?? "Invalid value",
    };
  });
}

function defined(
  code: string,
  status: number,
  message: string,
  data?: unknown,
): ORPCError<string, unknown> {
  return new ORPCError(code, { status, message, data, defined: true });
}

/** A declared error as the contract states it: its message and whether it has a data schema. */
type DeclaredErrors = Readonly<Record<string, { message?: string; data?: unknown } | undefined>>;

/** Rule 3b (A-166): the declared error with the declared message, and data only when declared. */
function declaredError(
  err: ORPCError<string, unknown>,
  declared?: DeclaredErrors,
): ORPCError<string, unknown> {
  const platform: DeclaredErrors = PLATFORM_ERRORS;
  const platformEntry = Object.hasOwn(platform, err.code) ? platform[err.code] : undefined;
  // The message: §6's for platform keys (A-170), else the declared one, else the key.
  const message = platformEntry?.message ?? declared?.[err.code]?.message ?? err.code;
  // The data: kept only when the procedure's own declaration (what oRPC validated against) has a
  // data schema; PLATFORM_ERRORS decides only when no map was passed (A-166(b)).
  const decidingEntry = declared === undefined ? platformEntry : declared[err.code];
  const data = decidingEntry?.data === undefined ? undefined : err.data;
  return defined(err.code, err.status, message, data);
}

export function mapError(
  err: unknown,
  state: { committed: boolean },
  /** The procedure's declared error map (rule 3b); platform keys use §6's messages regardless. */
  declared?: DeclaredErrors,
): { error: ORPCError<string, unknown>; report: boolean } {
  const outcome = state.committed ? "unknown" : "not_applied";

  if (err instanceof BudmonError) {
    return { error: defined(err.key, err.status, err.message, err.details), report: false };
  }
  if (err instanceof ORPCError) {
    if (err.code === "BAD_REQUEST" && err.cause instanceof ValidationError) {
      return {
        error: defined("VALIDATION_FAILED", 400, "Validation failed", {
          issues: issuesOf(err.cause),
        }),
        report: false,
      };
    }
    if (err.code === "INTERNAL_SERVER_ERROR" && err.cause instanceof ValidationError) {
      return { error: defined("INTERNAL", 500, "Internal error", { outcome }), report: true };
    }
    // Rule 3b (A-149, A-166): a contract-declared error keeps its code and status, never the
    // thrown message, and its data only when declared with a schema. INTERNAL and
    // SERVICE_UNAVAILABLE fall through to rules 5 and 6.
    if (err.defined && err.code !== "INTERNAL" && err.code !== "SERVICE_UNAVAILABLE") {
      return { error: declaredError(err as ORPCError<string, unknown>, declared), report: false };
    }
    if (!err.defined && err.code !== "INTERNAL_SERVER_ERROR") {
      // Unmatched routes and oRPC's other built-in errors (METHOD_NOT_SUPPORTED, …).
      return { error: defined("NOT_FOUND", 404, "Not found"), report: false };
    }
  }
  const code = errorCode(err);
  if (
    typeof code === "string" &&
    (UNAVAILABLE_SQLSTATES.has(code) || UNAVAILABLE_SYSTEM_CODES.has(code))
  ) {
    return {
      error: defined("SERVICE_UNAVAILABLE", 503, "Service unavailable", { outcome }),
      report: true,
    };
  }
  // Rule 5b (A-172): a defined SERVICE_UNAVAILABLE keeps 503 with §6's message; its data is the
  // outcome from the commit tracker, never the thrown data.
  if (err instanceof ORPCError && err.defined && err.code === "SERVICE_UNAVAILABLE") {
    return {
      error: defined(
        "SERVICE_UNAVAILABLE",
        PLATFORM_ERRORS.SERVICE_UNAVAILABLE.status,
        PLATFORM_ERRORS.SERVICE_UNAVAILABLE.message,
        { outcome },
      ),
      report: true,
    };
  }
  return { error: defined("INTERNAL", 500, "Internal error", { outcome }), report: true };
}

export interface ErrorInterceptorContext {
  requestId: string;
  principal: { userId: string } | null;
  commitTracker: { committed: boolean };
  responseHeaders: Headers;
}

/** oRPC client interceptor: maps every error (F-52), reports the unexpected ones. */
export function createErrorInterceptor(deps: { reporter: ErrorReporter; logger: Logger }) {
  return async <T>(options: {
    next: () => Promise<T>;
    context: ErrorInterceptorContext;
    path: readonly string[];
    route?: string;
    errorMap?: DeclaredErrors;
  }): Promise<T> => {
    try {
      return await options.next();
    } catch (err) {
      const { error, report } = mapError(err, options.context.commitTracker, options.errorMap);
      const route = options.route;
      if (report) {
        const userId = options.context.principal?.userId;
        deps.reporter.report(err, {
          requestId: options.context.requestId,
          ...(userId === undefined ? {} : { userId }),
          ...(route === undefined ? {} : { route }),
          errorKey: error.code,
        });
        deps.logger.error(
          "request_failed",
          {
            errorKey: error.code,
            requestId: options.context.requestId,
            ...(route === undefined ? {} : { route }),
          },
          err,
        );
      }
      if (error.code === "RATE_LIMITED") {
        const seconds = (error.data as { retryAfterSeconds?: number } | undefined)
          ?.retryAfterSeconds;
        if (seconds !== undefined) {
          options.context.responseHeaders.set("Retry-After", String(seconds));
        }
      }
      throw error;
    }
  };
}
