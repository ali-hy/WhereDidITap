// P-A-513 (1), P-A-514: the token generator's outputs are committed and current, and
// `generate.ts --check --root <dir>` reports stale outputs. TP-0b.1, plus extra cases TP-0b.1x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUTS = [
  "apps/web/src/styles/tokens.css",
  "apps/android/app/src/main/java/com/budmon/app/ui/theme/Tokens.kt",
];

const RECIPES = "tools/tokens/recipes.json";
const GENERATOR = path.join(ROOT, "tools/tokens/generate.ts");
// tsx's CLI, run with this node so no shell is needed (tools/ci depends on tsx).
const TSX_CLI = createRequire(path.join(ROOT, "tools/ci/package.json")).resolve("tsx/cli");

/** `tsx tools/tokens/generate.ts <args>` from the checkout (P-A-514). */
function generate(args: readonly string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, GENERATOR, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { status: result.status, stderr: result.stderr };
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const checkout = () => [RECIPES, ...OUTPUTS].map((f) => sha(path.join(ROOT, f)));

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** A temporary root holding copies of the recipes and both outputs at their checkout paths. */
function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "tokens-root-"));
  temps.push(root);
  for (const f of [RECIPES, ...OUTPUTS]) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(ROOT, f), path.join(root, f));
  }
  return root;
}

/** Changes one recipe value: the teal hue (guide §3.1: h = 186), else the first decimal. */
function changeOneRecipeValue(root: string): void {
  const file = path.join(root, RECIPES);
  const text = readFileSync(file, "utf8");
  const hue = /(?<![\d.])186(?![\d.])/;
  const changed = hue.test(text)
    ? text.replace(hue, "200")
    : text.replace(/\d+\.\d+/, (n) => String(Number(n) + 0.01));
  expect(changed).not.toBe(text);
  writeFileSync(file, changed);
}

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

describe("TP-0b.1: generate.ts --check --root (P-A-514)", () => {
  it("TP-0b.1: after one recipe value changes in a temporary root, --check exits 1 naming both stale outputs on stderr, and the checkout is untouched", () => {
    const before = checkout();
    const root = tempRoot();
    changeOneRecipeValue(root);

    const { status, stderr } = generate(["--check", "--root", root]);

    expect(status, stderr).toBe(1);
    const lines = stderr.split(/\r?\n/).filter((l) => l.startsWith("stale: "));
    expect(lines.sort()).toEqual(OUTPUTS.map((f) => `stale: ${f}`).sort());
    expect(checkout()).toEqual(before);
  });

  it("TP-0b.1x: --check on an unchanged copy exits 0 and writes nothing", () => {
    const root = tempRoot();
    const copied = [RECIPES, ...OUTPUTS].map((f) => sha(path.join(root, f)));

    const { status, stderr } = generate(["--check", "--root", root]);

    expect(status, stderr).toBe(0);
    expect([RECIPES, ...OUTPUTS].map((f) => sha(path.join(root, f)))).toEqual(copied);
  });

  it("TP-0b.1x: a missing output is stale (exit 1)", () => {
    const root = tempRoot();
    rmSync(path.join(root, OUTPUTS[1] ?? ""));

    const { status, stderr } = generate(["--check", "--root", root]);

    expect(status, stderr).toBe(1);
    expect(stderr.split(/\r?\n/).filter((l) => l.startsWith("stale: "))).toEqual([
      `stale: ${OUTPUTS[1] ?? ""}`,
    ]);
  });

  it("TP-0b.1x: without --check it rewrites the stale outputs under the root only, after which --check passes", () => {
    const before = checkout();
    const root = tempRoot();
    changeOneRecipeValue(root);

    expect(generate(["--root", root]).status).toBe(0);

    expect(generate(["--check", "--root", root]).status).toBe(0);
    expect(checkout()).toEqual(before);
  });

  it("TP-0b.1x: unreadable recipes exit 2 with 'recipes invalid: …'", () => {
    const root = tempRoot();
    writeFileSync(path.join(root, RECIPES), "{ not json");

    const { status, stderr } = generate(["--check", "--root", root]);

    expect(status).toBe(2);
    expect(stderr).toMatch(/^recipes invalid: /m);
  });

  it("TP-0b.1x: an unknown argument exits 2 with the usage line", () => {
    const { status, stderr } = generate(["--bogus"]);

    expect(status).toBe(2);
    expect(stderr).toContain("usage: generate.ts [--check] [--root <dir>]");
  });
});
