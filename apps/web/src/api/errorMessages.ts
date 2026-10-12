// F-203: the message for a failure, by operation (HLD §4.9).
import type { MessageDescriptor } from "@formatjs/intl";
import { messages } from "../i18n/messages.js";
import type { AppError } from "./errors.js";

export type Operation = "read" | "create" | "mutation";

export interface ErrorMessage {
  descriptor: MessageDescriptor;
  values?: Record<string, string | number>;
}

function outcomeOf(data: unknown): unknown {
  return typeof data === "object" && data !== null
    ? (data as { outcome?: unknown }).outcome
    : undefined;
}

function retryAfterOf(data: unknown): number {
  const value =
    typeof data === "object" && data !== null
      ? (data as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 60;
}

/** The generic message for the operation: nothing changed on a read; unknown otherwise. */
function generic(operation: Operation): ErrorMessage {
  return {
    descriptor:
      operation === "read" ? messages.errorGenericRead : messages.errorGenericUnknownOutcome,
  };
}

export function messageForError(e: AppError, operation: Operation): ErrorMessage {
  const read = operation === "read";
  switch (e.kind) {
    case "timeout":
      // A-326: a timed-out read changed nothing.
      return generic(operation);
    case "unavailable":
    case "network":
      return { descriptor: messages.errorUnavailable };
    case "unknown":
      return generic(operation);
    case "defined":
      break;
  }
  switch (e.key) {
    case "INTERNAL":
      if (read) return { descriptor: messages.errorGenericRead };
      return outcomeOf(e.data) === "not_applied"
        ? { descriptor: messages.errorGenericNotChanged }
        : { descriptor: messages.errorGenericUnknownOutcome };
    case "VALIDATION_FAILED":
      return { descriptor: messages.errorValidationForm };
    case "RATE_LIMITED":
      return {
        descriptor: messages.errorRateLimited,
        values: { minutes: Math.ceil(retryAfterOf(e.data) / 60) },
      };
    case "SERVICE_UNAVAILABLE":
      return !read && outcomeOf(e.data) === "unknown"
        ? { descriptor: messages.errorGenericUnknownOutcome }
        : { descriptor: messages.errorUnavailable };
    case "NOT_FOUND":
      return { descriptor: messages.errorNotFound };
    case "FORBIDDEN":
      return { descriptor: messages.errorForbidden };
    case "CLIENT_UPDATE_REQUIRED":
      return { descriptor: messages.updateRequiredWeb };
    default:
      return generic(operation);
  }
}
