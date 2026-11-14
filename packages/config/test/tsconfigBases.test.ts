// F-5 TypeScript and Prettier bases. TP-0.7, plus the extra cases TP-0.12x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function basePath(name: "base" | "node" | "web"): string {
  return path.join(CONFIG_DIR, "tsconfig", `${name}.json`);
}

let fixtureDir = "";

beforeEach(async () => {
  fixtureDir = await realpath(await mkdtemp(path.join(tmpdir(), "budmon-tsc-")));
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

/**
 * Writes a project that extends one of F-5's bases. `types: []` keeps the fixture independent of
 * installed `@types/*` packages (the `node` base asks for `types: ["node"]`); nothing else is
 * overridden.
 */
async function writeProject(base: "base" | "node" | "web", source: string): Promise<void> {
  await writeFile(
    path.join(fixtureDir, "tsconfig.json"),
    JSON.stringify({
      extends: basePath(base),
      compilerOptions: { noEmit: true, types: [] },
      files: ["index.ts"],
    }),
  );
  await writeFile(path.join(fixtureDir, "index.ts"), source);
}

function runTsc(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [TSC, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const UNCHECKED_INDEX = "const a: number[] = [];\nconst b: number = a[0];\nexport { b };\n";
const CHECKED_INDEX =
  "const a: number[] = [];\nconst b: number | undefined = a[0];\nexport { b };\n";

describe("F-5 TypeScript bases", () => {
  it("TP-0.7: an unchecked index access fails type-check with TS2322 under the base config", async () => {
    await writeProject("base", UNCHECKED_INDEX);

    const { status, output } = runTsc("-p", fixtureDir, "--pretty", "false");

    expect(status).not.toBe(0);
    expect(output).toMatch(/index\.ts\(2,\d+\): error TS2322/);
  });

  it("TP-0.7: the same access typed as `number | undefined` type-checks under the base config", async () => {
    await writeProject("base", CHECKED_INDEX);

    const { status, output } = runTsc("-p", fixtureDir, "--pretty", "false");

    expect(output).toBe("");
    expect(status).toBe(0);
  });

  it.each([["node" as const], ["web" as const]])(
    "TP-0.12x: an unchecked index access also fails with TS2322 under the %s config",
    async (base) => {
      await writeProject(base, UNCHECKED_INDEX);

      const { status, output } = runTsc("-p", fixtureDir, "--pretty", "false");

      expect(status).not.toBe(0);
      expect(output).toMatch(/index\.ts\(2,\d+\): error TS2322/);
    },
  );

  // TP-0.12x (added): the resolved options of each base are exactly those F-5 lists.
  describe("TP-0.12x: resolved compiler options", () => {
    async function resolvedOptions(
      base: "base" | "node" | "web",
    ): Promise<Record<string, unknown>> {
      await writeFile(path.join(fixtureDir, "index.ts"), "export {};\n");
      await writeFile(
        path.join(fixtureDir, "tsconfig.json"),
        JSON.stringify({ extends: basePath(base), files: ["index.ts"] }),
      );
      const { status, output } = runTsc("--showConfig", "-p", fixtureDir);
      expect(status, output).toBe(0);
      const parsed = JSON.parse(output) as { compilerOptions: Record<string, unknown> };
      return Object.fromEntries(
        Object.entries(parsed.compilerOptions).map(([key, value]) => [
          key,
          lowerCaseStrings(value),
        ]),
      );
    }

    function lowerCaseStrings(value: unknown): unknown {
      if (typeof value === "string") return value.toLowerCase();
      if (Array.isArray(value)) return value.map(lowerCaseStrings);
      return value;
    }

    const BASE_OPTIONS = {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      noUncheckedSideEffectImports: true,
      moduleDetection: "force",
      skipLibCheck: true,
      target: "es2024",
      declaration: true,
      sourceMap: true,
    };

    it("TP-0.12x: base has F-5's base options", async () => {
      expect(await resolvedOptions("base")).toMatchObject(BASE_OPTIONS);
    });

    it("TP-0.12x: node extends base with nodenext modules, ES2024 lib and node types", async () => {
      const options = await resolvedOptions("node");

      expect(options).toMatchObject({
        ...BASE_OPTIONS,
        module: "nodenext",
        moduleResolution: "nodenext",
        types: ["node"],
      });
      expect(options["lib"]).toEqual(["es2024"]);
    });

    it("TP-0.12x: web extends base with bundler resolution, Solid JSX and DOM libs", async () => {
      const options = await resolvedOptions("web");

      expect(options).toMatchObject({
        ...BASE_OPTIONS,
        module: "preserve",
        moduleResolution: "bundler",
        jsx: "preserve",
        jsxImportSource: "solid-js",
      });
      expect(options["lib"]).toEqual(["es2024", "dom", "dom.iterable"]);
    });
  });
});

describe("F-5 Prettier base", () => {
  it("TP-0.12x: the Prettier base is exactly F-5's options", async () => {
    const prettierBase = (await import("../prettier/index.js")) as { default: unknown };

    expect(prettierBase.default).toEqual({
      printWidth: 100,
      semi: true,
      singleQuote: false,
      trailingComma: "all",
    });
  });
});
