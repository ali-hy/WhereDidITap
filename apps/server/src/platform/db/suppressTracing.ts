// Statements that carry role passwords run with tracing suppressed, so no span's
// `db.query.text` can hold them (F-15 rule 3).
import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

export function withoutTracing<T>(fn: () => Promise<T>): Promise<T> {
  return context.with(suppressTracing(context.active()), fn);
}
