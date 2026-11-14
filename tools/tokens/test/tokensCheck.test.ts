// P-A-513 (1): the token generator's outputs are committed and current. TP-0b.1 (its first half;
// the stale-output case waits for the check's interface, see the S-0b report).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUTS = [
  "apps/web/src/styles/tokens.css",
  "apps/android/app/src/main/java/com/budmon/app/ui/theme/Tokens.kt",
];

function pnpm(args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("TP-0b.1: tokens:generate and tokens:check", () => {
  it("TP-0b.1: the root package.json has tokens:generate and tokens:check", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["tokens:generate"]).toBeTypeOf("string");
    expect(pkg.scripts?.["tokens:check"]).toBeTypeOf("string");
  });

  it("TP-0b.1: the recipes exist and hold the teal theme", () => {
    const recipes = readFileSync(path.join(ROOT, "tools/tokens/recipes.json"), "utf8");

    expect(() => JSON.parse(recipes) as unknown).not.toThrow();
    expect(recipes).toContain("teal");
  });

  it.each(OUTPUTS)("TP-0b.1: %s is committed with a generated header", (file) => {
    const head = readFileSync(path.join(ROOT, file), "utf8").split("\n").slice(0, 5).join("\n");

    expect(head.toLowerCase()).toContain("generated");
  });

  it("TP-0b.1: pnpm tokens:check passes on the committed outputs", () => {
    const { status, output } = pnpm(["tokens:check"]);

    expect(output).toBeTypeOf("string");
    expect(status, output).toBe(0);
  });
});
