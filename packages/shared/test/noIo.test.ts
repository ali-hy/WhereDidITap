// TP-1.26x (test-architect addition, not an LLD ID): S-1's acceptance criterion "the library has
// no I/O". No source file under packages/shared/src imports a Node built-in or uses a global I/O
// API.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const NODE_BUILTINS = new Set([
  "fs",
  "fs/promises",
  "path",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "tls",
  "dgram",
  "dns",
  "worker_threads",
  "cluster",
  "process",
]);

describe("TP-1.26x: @budmon/shared has no I/O", () => {
  it("TP-1.26x: packages/shared/src has source files", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it("TP-1.26x: no source file imports a Node built-in or calls fetch, process or XMLHttpRequest", () => {
    const problems: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      const specifiers = [
        ...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g),
      ].map((match) => match[1] ?? "");
      for (const specifier of specifiers) {
        if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier)) {
          problems.push(`${path.relative(SRC, file)} imports ${specifier}`);
        }
      }
      for (const api of [/\bfetch\s*\(/, /\bprocess\./, /\bXMLHttpRequest\b/]) {
        if (api.test(text)) problems.push(`${path.relative(SRC, file)} uses ${api.source}`);
      }
    }

    expect(problems).toEqual([]);
  });
});
