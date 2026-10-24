// F-343: create procedures (POST, 201, an Idempotency-Key header, a CreatedResult).
import { z } from "zod";
import { InstantWire } from "./dates.js";
import { base } from "./errors.js";
import { UuidSchema } from "./ids.js";

export const CreatedResultSchema = z.object({ id: UuidSchema, createdAt: InstantWire });

type Operation = Record<string, unknown> & { parameters?: unknown[] };

/** Adds the required Idempotency-Key header and `x-budmon-kind: create` to the operation. */
export function addIdempotencyKeyHeader<T extends object>(operation: T): T {
  const op = operation as unknown as Operation;
  return {
    ...op,
    parameters: [
      ...(op.parameters ?? []),
      {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    "x-budmon-kind": "create",
  } as unknown as T;
}

export function createRoute(path: `/${string}`) {
  return base
    .route({ method: "POST", path, successStatus: 201, spec: addIdempotencyKeyHeader })
    .meta({ kind: "create" })
    .output(CreatedResultSchema);
}
