// F-7: `.env.example` lists exactly the variables of F-10's configuration schema.
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allConfigKeys } from "../../apps/server/src/platform/config/schema.js";

export function checkEnvExample(
  schemaKeys: readonly string[],
  exampleText: string,
): { missingInExample: string[]; unknownInExample: string[] } {
  const listed = new Set<string>();
  for (const line of exampleText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) listed.add(trimmed.slice(0, separator).trim());
  }
  const known = new Set(schemaKeys);
  return {
    missingInExample: schemaKeys.filter((key) => !listed.has(key)),
    unknownInExample: [...listed].filter((key) => !known.has(key)),
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = checkEnvExample(
    allConfigKeys(),
    readFileSync(path.join(root, ".env.example"), "utf8"),
  );
  for (const key of result.missingInExample)
    process.stderr.write(`missing in .env.example: ${key}\n`);
  for (const key of result.unknownInExample)
    process.stderr.write(`unknown in .env.example: ${key}\n`);
  process.exitCode = result.missingInExample.length + result.unknownInExample.length > 0 ? 1 : 0;
}
