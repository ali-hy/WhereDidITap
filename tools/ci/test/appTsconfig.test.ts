// TP-2.25: apps/server and (from S-11a, (c)) apps/web have tsconfigs the ESLint project service and
// `pnpm typecheck` use (A-30).
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("TP-2.25: app tsconfigs (A-30)", () => {
  it("TP-2.25 (a): ESLint parses apps/server/src/main/api.ts and test/setup/globalSetup.ts with the project service", () => {
    const { status, output } = run(
      path.join(ROOT, "node_modules/.bin/eslint"),
      ["apps/server/src/main/api.ts", "apps/server/test/setup/globalSetup.ts"],
      ROOT,
    );

    expect(status, output).toBe(0);
    expect(output).not.toMatch(/project service/i);
    expect(output).not.toMatch(/Parsing error/i);
  }, 120_000);

  it("TP-2.25 (b): pnpm typecheck fails on a type error planted in apps/server/src/main/api.ts, naming the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-typecheck-"));
    try {
      const checkout = path.join(dir, "budmon");
      const clone = run("git", ["clone", "--quiet", "--no-hardlinks", ROOT, checkout], dir);
      expect(clone.status, clone.output).toBe(0);
      const install = run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], checkout);
      expect(install.status, install.output).toBe(0);
      appendFileSync(
        path.join(checkout, "apps/server/src/main/api.ts"),
        '\nexport const plantedTypeError: number = "not a number";\n',
      );

      const typecheck = run("pnpm", ["typecheck"], checkout);

      expect(typecheck.status).not.toBe(0);
      expect(typecheck.output).toContain("apps/server/src/main/api.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);

  it("TP-2.25 (c): ESLint parses apps/web/src/main.tsx with the project service", () => {
    const { status, output } = run(
      path.join(ROOT, "node_modules/.bin/eslint"),
      ["apps/web/src/main.tsx"],
      ROOT,
    );

    expect(status, output).toBe(0);
    expect(output).not.toMatch(/project service/i);
    expect(output).not.toMatch(/Parsing error/i);
  }, 120_000);

  it("TP-2.25 (c): pnpm typecheck fails on a type error planted in apps/web/src/main.tsx, naming the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-typecheck-web-"));
    try {
      const checkout = path.join(dir, "budmon");
      const clone = run("git", ["clone", "--quiet", "--no-hardlinks", ROOT, checkout], dir);
      expect(clone.status, clone.output).toBe(0);
      const install = run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], checkout);
      expect(install.status, install.output).toBe(0);
      appendFileSync(
        path.join(checkout, "apps/web/src/main.tsx"),
        '\nexport const plantedTypeError: number = "not a number";\n',
      );

      const typecheck = run("pnpm", ["typecheck"], checkout);

      expect(typecheck.status).not.toBe(0);
      expect(typecheck.output).toContain("apps/web/src/main.tsx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
