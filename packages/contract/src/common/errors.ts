// F-342: the platform error map. Every procedure is built from `base`.
import { oc } from "@orpc/contract";
import { z } from "zod";

export const IssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number().int()])),
  code: z.string(),
  message: z.string(),
});

export const OutcomeSchema = z.enum(["not_applied", "unknown"]);

export const PLATFORM_ERRORS = {
  VALIDATION_FAILED: {
    status: 400,
    message: "Validation failed",
    data: z.object({ issues: z.array(IssueSchema) }),
  },
  CLIENT_UPDATE_REQUIRED: {
    status: 400,
    message: "Client update required",
    data: z.object({ minimumVersion: z.number().int().min(0) }),
  },
  UNAUTHENTICATED: { status: 401, message: "Authentication required" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  NOT_FOUND: { status: 404, message: "Not found" },
  CONFLICT: {
    status: 409,
    message: "Conflict",
    data: z.record(z.string(), z.string()).optional(),
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: "Idempotency key reused with a different request",
  },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Payload too large" },
  RATE_LIMITED: {
    status: 429,
    message: "Too many requests",
    data: z.object({ retryAfterSeconds: z.number().int().min(1) }),
  },
  INTERNAL: { status: 500, message: "Internal error", data: z.object({ outcome: OutcomeSchema }) },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "Service unavailable",
    data: z.object({ outcome: OutcomeSchema }).optional(),
  },
} as const;

export const base = oc.errors(PLATFORM_ERRORS);
