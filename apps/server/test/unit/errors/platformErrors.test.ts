// F-51 platform errors against §6. Extra cases TP-4.36x (F-51 has no LLD test case of its own; the
// envelopes are TP-4.9's). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";
import {
  ClientUpdateRequiredError,
  ConflictError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthenticatedError,
  ValidationFailedError,
} from "../../../src/platform/errors/platformErrors.js";

const ISSUE = { path: ["name"], code: "too_big", message: "Too big" };

describe("TP-4.36x: F-51 errors carry §6's key, status, message and data", () => {
  it.each([
    [
      "ValidationFailedError",
      new ValidationFailedError([ISSUE]),
      "VALIDATION_FAILED",
      400,
      "Validation failed",
      { issues: [ISSUE] },
    ],
    [
      "ClientUpdateRequiredError",
      new ClientUpdateRequiredError(5),
      "CLIENT_UPDATE_REQUIRED",
      400,
      "Client update required",
      { minimumVersion: 5 },
    ],
    [
      "UnauthenticatedError",
      new UnauthenticatedError(),
      "UNAUTHENTICATED",
      401,
      "Authentication required",
      undefined,
    ],
    ["ForbiddenError", new ForbiddenError(), "FORBIDDEN", 403, "Forbidden", undefined],
    ["NotFoundError", new NotFoundError(), "NOT_FOUND", 404, "Not found", undefined],
    [
      "ConflictError",
      new ConflictError({ field: "name" }),
      "CONFLICT",
      409,
      "Conflict",
      { field: "name" },
    ],
    [
      "IdempotencyKeyReusedError",
      new IdempotencyKeyReusedError(),
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "Idempotency key reused with a different request",
      undefined,
    ],
    [
      "PayloadTooLargeError",
      new PayloadTooLargeError(),
      "PAYLOAD_TOO_LARGE",
      413,
      "Payload too large",
      undefined,
    ],
    [
      "RateLimitedError",
      new RateLimitedError(30),
      "RATE_LIMITED",
      429,
      "Too many requests",
      { retryAfterSeconds: 30 },
    ],
    [
      "ServiceUnavailableError",
      new ServiceUnavailableError("unknown"),
      "SERVICE_UNAVAILABLE",
      503,
      "Service unavailable",
      { outcome: "unknown" },
    ],
  ] as const)("TP-4.36x: %s", (name, err, key, status, message, details) => {
    expect(err).toBeInstanceOf(BudmonError);
    expect(err.name).toBe(name);
    expect([err.key, err.status, err.message]).toEqual([key, status, message]);
    expect(err.details).toEqual(details);
  });

  it("TP-4.36x: ConflictError without details has no data", () => {
    expect(new ConflictError().details).toBeUndefined();
  });
});
