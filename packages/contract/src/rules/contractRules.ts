// F-348: contract rules over the emitted OpenAPI document.
import type { OpenAPIV3_1 } from "openapi-types";

export interface Violation {
  rule: string;
  location: string;
}

type Json = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const SCHEMA_KEYS = ["type", "$ref", "anyOf", "oneOf", "allOf", "enum", "const"];
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function escape(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function at(pointer: string, ...segments: (string | number)[]): string {
  return `${pointer}/${segments.map((s) => escape(String(s))).join("/")}`;
}

function types(schema: Json): string[] {
  const type = schema["type"];
  if (typeof type === "string") return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === "string") : [];
}

/** Calls `visit` for a schema and every schema nested in it. */
function walkSchema(schema: unknown, pointer: string, visit: (s: Json, p: string) => void): void {
  const s = record(schema);
  if (s === undefined) return;
  visit(s, pointer);
  const properties = record(s["properties"]);
  if (properties !== undefined) {
    for (const [key, child] of Object.entries(properties)) {
      walkSchema(child, at(pointer, "properties", key), visit);
    }
  }
  for (const key of ["items", "additionalProperties", "not", "contains", "propertyNames"]) {
    if (record(s[key]) !== undefined) walkSchema(s[key], at(pointer, key), visit);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const list = s[key];
    if (Array.isArray(list)) {
      list.forEach((child, i) => {
        walkSchema(child, at(pointer, key, i), visit);
      });
    }
  }
}

function untyped(schema: Json): boolean {
  return !SCHEMA_KEYS.some((key) => key in schema);
}

function int64Rule(schema: Json, pointer: string, out: Violation[]): void {
  if (
    types(schema).includes("integer") &&
    schema["format"] === "int64" &&
    (schema["minimum"] === undefined || schema["maximum"] === undefined)
  ) {
    out.push({ rule: "R2", location: pointer });
  }
}

function numberRule(schema: Json, pointer: string, out: Violation[]): void {
  if (types(schema).includes("number") && schema["x-budmon-allow-number"] !== true) {
    out.push({ rule: "R3", location: pointer });
  }
}

function resolve(doc: Json, schema: unknown): Json | undefined {
  let current = record(schema);
  for (let i = 0; i < 10 && typeof current?.["$ref"] === "string"; i++) {
    const parts = current["$ref"].replace(/^#\//, "").split("/");
    let target: unknown = doc;
    for (const part of parts) {
      target = record(target)?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    current = record(target);
  }
  return current;
}

function allowedParameterSchema(doc: Json, schema: unknown): boolean {
  const s = resolve(doc, schema);
  if (s === undefined) return false;
  const t = types(s);
  return (
    s["format"] === "uuid" ||
    Array.isArray(s["enum"]) ||
    s["format"] === "date" ||
    s["pattern"] === DATE_PATTERN ||
    t.includes("integer") ||
    t.includes("boolean") ||
    (t.includes("string") && s["x-budmon-cursor"] === true)
  );
}

/** A-165, A-173, A-175: a path parameter of an operation other than GET isn't coerced, so it
 * must be a string. */
function stringParameterSchema(doc: Json, schema: unknown): boolean {
  const s = resolve(doc, schema);
  if (s === undefined || !types(s).includes("string")) return false;
  return (
    s["format"] === "uuid" ||
    Array.isArray(s["enum"]) ||
    s["format"] === "date" ||
    s["pattern"] === DATE_PATTERN
  );
}

function isCreatedResult(doc: Json, schema: unknown): boolean {
  const s = resolve(doc, schema);
  const properties = record(s?.["properties"]);
  if (s === undefined || properties === undefined || !types(s).includes("object")) return false;
  const keys = Object.keys(properties).sort();
  const id = resolve(doc, properties["id"]);
  const required = Array.isArray(s["required"]) ? s["required"] : [];
  return (
    keys.join(",") === "createdAt,id" &&
    id?.["format"] === "uuid" &&
    required.includes("id") &&
    required.includes("createdAt")
  );
}

/** The schemas of an operation's request body and success responses, with their pointers. */
function bodySchemas(op: Json, pointer: string): [unknown, string][] {
  const out: [unknown, string][] = [];
  const add = (container: unknown, base: string): void => {
    const content = record(record(container)?.["content"]);
    if (content === undefined) return;
    for (const [type, media] of Object.entries(content)) {
      const schema = record(media)?.["schema"];
      if (schema !== undefined) out.push([schema, at(base, "content", type, "schema")]);
    }
  };
  add(op["requestBody"], at(pointer, "requestBody"));
  const responses = record(op["responses"]);
  if (responses !== undefined) {
    for (const [status, response] of Object.entries(responses)) {
      // Error responses are oRPC's generated envelopes for PLATFORM_ERRORS (F-342), including its
      // catch-all for undefined errors (`data: {}`, `status: number`); the rules cover the
      // contract's own schemas: request bodies and success responses.
      if (status.startsWith("2")) add(response, at(pointer, "responses", status));
    }
  }
  return out;
}

export function checkContractRules(document: OpenAPIV3_1.Document): Violation[] {
  const doc = document as unknown as Json;
  const violations: Violation[] = [];
  const operationIds = new Set<string>();

  for (const [route, item] of Object.entries(record(doc["paths"]) ?? {})) {
    for (const method of METHODS) {
      const op = record(record(item)?.[method]);
      if (op === undefined) continue;
      const pointer = at("#/paths", route, method);

      for (const [schema, schemaPointer] of bodySchemas(op, pointer)) {
        walkSchema(schema, schemaPointer, (s, p) => {
          if (untyped(s)) violations.push({ rule: "R1", location: p });
          int64Rule(s, p, violations);
          numberRule(s, p, violations);
        });
      }

      // A-173: a DELETE takes path parameters only.
      if ((method === "get" || method === "delete") && op["requestBody"] !== undefined) {
        violations.push({ rule: "R4", location: at(pointer, "requestBody") });
      }
      const parameters = Array.isArray(op["parameters"]) ? op["parameters"] : [];
      parameters.forEach((raw: unknown, i) => {
        const parameter = record(raw);
        if (parameter === undefined) return;
        const p = at(pointer, "parameters", i);
        walkSchema(parameter["schema"], at(p, "schema"), (s, sp) => {
          int64Rule(s, sp, violations);
          numberRule(s, sp, violations);
        });
        const where = parameter["in"];
        if (
          ((where === "query" || where === "path") &&
            !allowedParameterSchema(doc, parameter["schema"])) ||
          (where === "query" && method === "delete") ||
          (where === "path" && method !== "get" && !stringParameterSchema(doc, parameter["schema"]))
        ) {
          violations.push({ rule: "R4", location: p });
        }
      });

      if (op["x-budmon-kind"] === "create") {
        const hasKey = parameters.some((raw: unknown) => {
          const parameter = record(raw);
          return (
            parameter?.["in"] === "header" &&
            parameter["name"] === "Idempotency-Key" &&
            parameter["required"] === true
          );
        });
        const created = record(record(record(op["responses"])?.["201"])?.["content"]);
        const schema = record(created?.["application/json"])?.["schema"];
        if (!hasKey || schema === undefined || !isCreatedResult(doc, schema)) {
          violations.push({ rule: "R5", location: pointer });
        }
      }

      const id = op["operationId"];
      if (typeof id === "string") {
        if (operationIds.has(id))
          violations.push({ rule: "R6", location: at(pointer, "operationId") });
        operationIds.add(id);
      }
    }
  }
  return violations;
}
