// The web build (F-221, S-11a acceptance criteria, A-313): TP-11.27, AC-11.1 and AC-11.3. Builds go
// to temporary directories, so apps/web/dist isn't touched.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function run(
  command: string,
  args: readonly string[],
  env: Record<string, string> = {},
): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1", ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withOutDir<T>(fn: (outDir: string) => T): T {
  const outDir = mkdtempSync(path.join(tmpdir(), "budmon-web-build-"));
  try {
    return fn(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** `vite build` into `outDir` with `env` (an undefined value unsets the variable). */
function viteBuild(
  outDir: string,
  env: Record<string, string | undefined>,
): { status: number | null; output: string } {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    ...env,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) Reflect.deleteProperty(merged, key);
  }
  const result = spawnSync(
    "pnpm",
    ["--filter", "@budmon/web", "exec", "vite", "build", "--outDir", outDir, "--emptyOutDir"],
    { cwd: ROOT, encoding: "utf8", env: merged },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

describe("TP-11.27: version.json (F-221)", () => {
  it('TP-11.27: BUDMON_BUILD_NUMBER=12 vite build writes version.json {"buildNumber":12}', () => {
    withOutDir((outDir) => {
      const { status, output } = run(
        "pnpm",
        ["--filter", "@budmon/web", "exec", "vite", "build", "--outDir", outDir, "--emptyOutDir"],
        { BUDMON_BUILD_NUMBER: "12" },
      );

      expect(status, output).toBe(0);
      expect(readFileSync(path.join(outDir, "version.json"), "utf8")).toBe('{"buildNumber":12}');
    });
  }, 300_000);

  // A-320: unset is 0; set (even empty) must match ^\d{1,9}$, read as decimal.
  it.each([
    ["unset", undefined, 0],
    ['"007"', "007", 7],
  ])(
    "TP-11.27 (A-320): BUDMON_BUILD_NUMBER %s gives {buildNumber: %i}",
    (_label, value, expected) => {
      withOutDir((outDir) => {
        const { status, output } = viteBuild(outDir, { BUDMON_BUILD_NUMBER: value });

        expect(status, output).toBe(0);
        expect(readFileSync(path.join(outDir, "version.json"), "utf8")).toBe(
          JSON.stringify({ buildNumber: expected }),
        );
      });
    },
    300_000,
  );

  it.each([[""], ["abc"], ["1234567890"], ["-1"]])(
    "TP-11.27 (A-320): BUDMON_BUILD_NUMBER %j fails the build, naming the variable, with no version.json",
    (value) => {
      withOutDir((outDir) => {
        const { status, output } = viteBuild(outDir, { BUDMON_BUILD_NUMBER: value });

        expect(status, output).not.toBe(0);
        expect(output).toContain("BUDMON_BUILD_NUMBER");
        expect(existsSync(path.join(outDir, "version.json"))).toBe(false);
      });
    },
    300_000,
  );

  // A-332: fixtures are folded away from a normal build.
  it("TP-11.27 (A-332): a build without VITE_FIXTURES has no file containing __fixtures", () => {
    withOutDir((outDir) => {
      const { status, output } = viteBuild(outDir, {
        VITE_FIXTURES: undefined,
        VITE_PSEUDO_LOCALES: undefined,
      });

      expect(status, output).toBe(0);
      const offending = filesUnder(outDir).filter((file) =>
        readFileSync(file).includes("__fixtures"),
      );
      expect(offending.map((f) => path.relative(outDir, f))).toEqual([]);
    });
  }, 300_000);
});

describe("TP-11.27 (A-342): the MSW worker ships only with fixtures", () => {
  it("TP-11.27 (A-342): a normal build has no mockServiceWorker.js; a VITE_FIXTURES=1 build does", () => {
    withOutDir((normal) => {
      const plain = viteBuild(normal, { VITE_FIXTURES: undefined });
      expect(plain.status, plain.output).toBe(0);
      expect(filesUnder(normal).filter((f) => path.basename(f) === "mockServiceWorker.js")).toEqual(
        [],
      );
    });
    withOutDir((fixtures) => {
      const built = viteBuild(fixtures, { VITE_FIXTURES: "1" });
      expect(built.status, built.output).toBe(0);
      expect(existsSync(path.join(fixtures, "mockServiceWorker.js"))).toBe(true);
    });
  }, 600_000);
});

describe("S-11a acceptance criteria", () => {
  it("AC-11.1: pnpm --filter @budmon/web build produces the app (index.html) and version.json (buildNumber 0 outside release builds)", () => {
    withOutDir((outDir) => {
      const env = { ...process.env };
      delete env["BUDMON_BUILD_NUMBER"];
      const result = spawnSync(
        "pnpm",
        ["--filter", "@budmon/web", "build", "--outDir", outDir, "--emptyOutDir"],
        { cwd: ROOT, encoding: "utf8", env: { ...env, CI: "true", NO_COLOR: "1" } },
      );

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(existsSync(path.join(outDir, "index.html"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(outDir, "version.json"), "utf8"))).toEqual({
        buildNumber: 0,
      });
    });
  }, 300_000);

  it("AC-11.3: the web sources have no physical Tailwind utilities or CSS properties (ESLint's budmon/no-physical-tailwind and lint:css pass)", () => {
    const eslint = run(path.join(ROOT, "node_modules/.bin/eslint"), ["apps/web/src"]);
    const css = run("pnpm", ["lint:css"]);

    expect(eslint.status, eslint.output).toBe(0);
    expect(eslint.output).not.toContain("budmon/no-physical-tailwind");
    expect(css.status, css.output).toBe(0);
  }, 300_000);
});
