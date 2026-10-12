// TP-0.23: the rules for every workflow under .github/workflows/ (§2.2, A-17). Every job- and
// step-level `uses:` is pinned to a 40-hex commit SHA, except local `./` references; no `run:`
// script contains a `${{` expression (values reach scripts only through `env:`).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOWS = path.join(ROOT, ".github/workflows");

interface Step {
  uses?: unknown;
  run?: unknown;
}

interface Job {
  uses?: unknown;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
}

function jobsOf(file: string): [string, Job][] {
  const parsed = parse(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow | null;
  return Object.entries(parsed?.jobs ?? {});
}

/** Local actions and reusable workflows (`./…`) live in this repository and need no pin. */
function isPinned(uses: string): boolean {
  return uses.startsWith("./") || /^[^@\s]+@[0-9a-f]{40}$/.test(uses);
}

describe("TP-0.23: workflow security", () => {
  it("TP-0.23: .github/workflows has at least one workflow file", () => {
    expect(workflowFiles().length).toBeGreaterThan(0);
  });

  it("TP-0.23: every uses: is pinned to a 40-hex commit SHA", () => {
    const unpinned: string[] = [];
    for (const file of workflowFiles()) {
      for (const [jobName, job] of jobsOf(file)) {
        const uses = [job.uses, ...(job.steps ?? []).map((step) => step.uses)];
        for (const value of uses) {
          if (value === undefined) continue;
          if (typeof value !== "string" || !isPinned(value)) {
            unpinned.push(`${file} ${jobName}: ${JSON.stringify(value)}`);
          }
        }
      }
    }

    expect(unpinned).toEqual([]);
  });

  it("TP-0.23: no run: contains a ${{ expression", () => {
    const interpolated: string[] = [];
    for (const file of workflowFiles()) {
      for (const [jobName, job] of jobsOf(file)) {
        for (const [index, step] of (job.steps ?? []).entries()) {
          if (typeof step.run === "string" && step.run.includes("${{")) {
            interpolated.push(`${file} ${jobName} step ${String(index)}`);
          }
        }
      }
    }

    expect(interpolated).toEqual([]);
  });
});
