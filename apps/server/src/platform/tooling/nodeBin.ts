// F-22b: a package's `bin` script, for the development scripts. Never reads `.bin` shims.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type NodeBinMissingReason = "not_installed" | "no_bin";

/** A tool's package or its bin script is missing. `describeFailure` reports its `reason`. */
export class NodeBinMissingError extends Error {
  readonly packageName: string;
  readonly reason: NodeBinMissingReason;

  constructor(packageName: string, reason: NodeBinMissingReason, binName?: string) {
    super(
      reason === "not_installed"
        ? `${packageName} isn't installed; run pnpm install`
        : `${packageName} has no ${binName ?? packageName.slice(packageName.lastIndexOf("/") + 1)} bin`,
    );
    this.name = "NodeBinMissingError";
    this.packageName = packageName;
    this.reason = reason;
  }
}

/**
 * Absolute path of `packageName`'s bin script, resolved from `fromDir`.
 * - A string `bin` serves the package's own (unscoped) name; an object `bin` is looked up by name.
 * - Doesn't check that the script exists.
 */
export function resolveNodeBin(
  fromDir: string,
  packageName: string,
  binName?: string,
  deps: {
    resolve?: (fromDir: string, request: string) => string;
    readFile?: (file: string) => string;
  } = {},
): string {
  const resolve =
    deps.resolve ??
    ((dir: string, request: string) =>
      createRequire(path.join(dir, "package.json")).resolve(request));
  const readFile = deps.readFile ?? ((file: string) => readFileSync(file, "utf8"));

  let manifest: string;
  try {
    manifest = resolve(fromDir, `${packageName}/package.json`);
  } catch {
    throw new NodeBinMissingError(packageName, "not_installed");
  }

  const own = packageName.slice(packageName.lastIndexOf("/") + 1);
  const name = binName ?? own;
  let value: unknown;
  try {
    const bin = (JSON.parse(readFile(manifest)) as { bin?: unknown }).bin;
    if (typeof bin === "string") {
      value = name === own ? bin : undefined;
    } else if (typeof bin === "object" && bin !== null) {
      value = (bin as Record<string, unknown>)[name];
    }
  } catch {
    value = undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new NodeBinMissingError(packageName, "no_bin", name);
  }
  return path.resolve(path.dirname(manifest), value);
}
