// F-344: list inputs and outputs with opaque cursors.
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

export const CursorSchema = z.string().max(512).meta({ "x-budmon-cursor": true });
// The converter doesn't carry custom meta keys, so the emitted schema is registered (R4).
JSON_SCHEMA_REGISTRY.add(CursorSchema, {
  type: "string",
  maxLength: 512,
  "x-budmon-cursor": true,
} as never);

export function listInput<F extends z.ZodRawShape>(filters: F) {
  return z.object({
    ...filters,
    cursor: CursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  });
}

export function listOutput<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: CursorSchema.nullable() });
}
