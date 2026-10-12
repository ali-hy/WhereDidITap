// F-51: the platform errors of §6, each with its key, status and fixed developer message.
import { BudmonError } from "./BudmonError.js";

export interface Issue {
  path: (string | number)[];
  code: string;
  message: string;
}

export type Outcome = "not_applied" | "unknown";

export class ValidationFailedError extends BudmonError<{ issues: readonly Issue[] }> {
  constructor(issues: readonly Issue[]) {
    super("VALIDATION_FAILED", 400, "Validation failed", { issues });
  }
}

export class ClientUpdateRequiredError extends BudmonError<{ minimumVersion: number }> {
  constructor(minimumVersion: number) {
    super("CLIENT_UPDATE_REQUIRED", 400, "Client update required", { minimumVersion });
  }
}

export class UnauthenticatedError extends BudmonError {
  constructor() {
    super("UNAUTHENTICATED", 401, "Authentication required");
  }
}

export class ForbiddenError extends BudmonError {
  constructor() {
    super("FORBIDDEN", 403, "Forbidden");
  }
}

export class NotFoundError extends BudmonError {
  constructor() {
    super("NOT_FOUND", 404, "Not found");
  }
}

export class ConflictError extends BudmonError<Record<string, string> | undefined> {
  constructor(details?: Record<string, string>) {
    super("CONFLICT", 409, "Conflict", details);
  }
}

export class IdempotencyKeyReusedError extends BudmonError {
  constructor() {
    super("IDEMPOTENCY_KEY_REUSED", 409, "Idempotency key reused with a different request");
  }
}

export class PayloadTooLargeError extends BudmonError {
  constructor() {
    super("PAYLOAD_TOO_LARGE", 413, "Payload too large");
  }
}

export class RateLimitedError extends BudmonError<{ retryAfterSeconds: number }> {
  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", 429, "Too many requests", { retryAfterSeconds });
  }
}

export class ServiceUnavailableError extends BudmonError<{ outcome: Outcome }> {
  constructor(outcome: Outcome) {
    super("SERVICE_UNAVAILABLE", 503, "Service unavailable", { outcome });
  }
}
