// F-8: a pull request that changes the contract's OpenAPI document bumps API_MINOR.
import { readFileSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const MESSAGE = "The contract changed; bump API_MINOR in packages/contract/src/common/version.ts";

function withoutVersion(doc: object): object {
  const copy = structuredClone(doc) as { info?: Record<string, unknown> };
  if (copy.info !== undefined) delete copy.info["version"];
  return copy;
}

function minorOf(doc: object): number | undefined {
  const version = (doc as { info?: { version?: unknown } }).info?.version;
  if (typeof version !== "string") return undefined;
  const match = /^1\.(\d+)$/.exec(version);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

export function checkApiMinor(input: { baseOpenapi: object; headOpenapi: object }): {
  ok: boolean;
  message: string;
} {
  if (isDeepStrictEqual(withoutVersion(input.baseOpenapi), withoutVersion(input.headOpenapi))) {
    return { ok: true, message: "The contract is unchanged" };
  }
  const base = minorOf(input.baseOpenapi);
  const head = minorOf(input.headOpenapi);
  if (base !== undefined && head !== undefined && head > base) {
    return { ok: true, message: `The contract changed and API_MINOR is ${String(head)}` };
  }
  return { ok: false, message: MESSAGE };
}

// CLI: tsx checkApiMinor.ts <base openapi.json> <head openapi.json>
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [basePath, headPath] = process.argv.slice(2);
  if (basePath === undefined || headPath === undefined) {
    process.stderr.write("Usage: checkApiMinor.ts <base openapi.json> <head openapi.json>\n");
    process.exitCode = 64;
  } else {
    const result = checkApiMinor({
      baseOpenapi: JSON.parse(readFileSync(basePath, "utf8")) as object,
      headOpenapi: JSON.parse(readFileSync(headPath, "utf8")) as object,
    });
    (result.ok ? process.stdout : process.stderr).write(`checkApiMinor: ${result.message}\n`);
    process.exitCode = result.ok ? 0 : 1;
  }
}
