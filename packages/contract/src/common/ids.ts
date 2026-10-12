// F-340: identifiers on the wire (lower-case UUIDs), emitted as `format: uuid` with the pattern.
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

/** A-153, A-169: a copy of F-311's `UUID_PATTERN` (version 1 to 8, variant 8, 9, a or b); nil and
 * max are refused. TP-4.28 checks the copy against the original. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const UuidSchema = z.string().regex(UUID_PATTERN);
// Merged into the converted schema, which supplies `type: "string"`.
JSON_SCHEMA_REGISTRY.add(UuidSchema, {
  format: "uuid",
  pattern: UUID_PATTERN.source,
});
