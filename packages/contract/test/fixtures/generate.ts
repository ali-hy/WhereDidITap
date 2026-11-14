// Generates an OpenAPI document from a contract with F-347's generator configuration, for the
// contract tests' fixtures. Test-architect's helper.
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

export async function generate(contract: object): Promise<Record<string, unknown>> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
  const doc = await generator.generate(contract as never, {
    info: { title: "Budmon API", version: "1.0" },
    servers: [{ url: "/api/v1" }],
  });
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

/** Follows `$ref`s into `components`, so tests can read a schema whether or not it was inlined. */
export function resolve(doc: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  let current = schema as Record<string, unknown>;
  for (let i = 0; i < 10 && typeof current["$ref"] === "string"; i++) {
    const pointer = current["$ref"].replace(/^#\//, "").split("/");
    let target: unknown = doc;
    for (const part of pointer)
      target = (target as Record<string, unknown>)[
        part.replaceAll("~1", "/").replaceAll("~0", "~")
      ];
    current = target as Record<string, unknown>;
  }
  return current;
}

export type JsonObject = Record<string, unknown>;

/** Walks `path` from `value` and returns the object found there; throws if any step isn't one. */
export function obj(value: unknown, ...path: string[]): JsonObject {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) throw new Error(`no object at ${key}`);
    current = (current as JsonObject)[key];
  }
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new Error(`not an object at ${path.join("/")}`);
  }
  return current as JsonObject;
}

/** Walks `path` from `value` and returns the array found there; throws if it isn't one. */
export function arr(value: unknown, ...path: string[]): unknown[] {
  const parent = obj(value, ...path.slice(0, -1));
  const found = parent[path.at(-1) ?? ""];
  if (!Array.isArray(found)) throw new Error(`not an array at ${path.join("/")}`);
  return found;
}
