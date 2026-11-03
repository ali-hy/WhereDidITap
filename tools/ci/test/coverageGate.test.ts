// TP-1.15: the money/ branch-coverage gate, `pnpm test:coverage` (A-35), plus the extra case
// TP-1.27x (test-architect addition, not an LLD ID) for its CI wiring.
//
// Lives in the `tools` project, not `shared`: `test:coverage` runs the `shared` project, so a test
// there would run itself. Both runs use a fresh clone of HEAD (the committed tree), so planting the
// untested branch never touches this checkout.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Run {
  status: number | null;
  output: string;
}

function run(command: string, args: readonly string[], cwd: string): Run {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Clones HEAD, installs, optionally edits the clone, then runs `pnpm test:coverage` there. */
function coverageInCleanClone(edit?: (checkout: string) => void): Run {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-coverage-"));
  try {
    const checkout = path.join(dir, "budmon");
    const clone = run("git", ["clone", "--quiet", "--no-hardlinks", ROOT, checkout], dir);
    if (clone.status !== 0) throw new Error(`git clone failed: ${clone.output}`);
    const install = run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], checkout);
    if (install.status !== 0) throw new Error(`pnpm install failed: ${install.output}`);
    edit?.(checkout);
    return run("pnpm", ["test:coverage"], checkout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TP-1.15: pnpm test:coverage", () => {
  it("TP-1.15 (a): passes with 100 % branch coverage of money/", () => {
    const { status, output } = coverageInCleanClone();

    expect(status, output).toBe(0);
    expect(output).toMatch(/Branches\s*:\s*100%/);
  }, 600_000);

  it("TP-1.15 (b): an untested branch in money/money.ts fails it on the branch threshold", () => {
    const { status, output } = coverageInCleanClone((checkout) => {
      appendFileSync(
        path.join(checkout, "packages/shared/src/money/money.ts"),
        "\nexport function plantedUntestedBranch(flag: boolean): number {\n  return flag ? 1 : 2;\n}\n",
      );
    });

    expect(status, output).not.toBe(0);
    expect(output).toMatch(/branches/i);
    expect(output).toMatch(/threshold/i);
  }, 600_000);
});

describe("TP-1.27x: CI runs the coverage gate (A-35)", () => {
  it("TP-1.27x: ci.yml's check job runs pnpm test:coverage after pnpm test", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: { check?: { steps?: { run?: unknown }[] } };
    };
    const commands = (workflow.jobs?.check?.steps ?? [])
      .flatMap((step) => (typeof step.run === "string" ? step.run.split("\n") : []))
      .map((line) => line.trim());

    const test = commands.indexOf("pnpm test");
    const coverage = commands.indexOf("pnpm test:coverage");
    expect(test).toBeGreaterThanOrEqual(0);
    expect(coverage).toBeGreaterThan(test);
  });
});
