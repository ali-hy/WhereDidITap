// F-347: emits the contract's OpenAPI document (`pnpm contract:openapi`).
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { API_VERSION, contract } from "../src/index.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

export async function emitOpenapi(): Promise<string> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
  const doc = await generator.generate(contract, {
    info: { title: "Budmon API", version: API_VERSION },
    servers: [{ url: "/api/v1" }],
  });
  return `${JSON.stringify(sortKeys(JSON.parse(JSON.stringify(doc))), null, 2)}\n`;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
  writeFileSync(out, await emitOpenapi());
}
