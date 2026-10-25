// TP-0.25 (added in S-2, A-87): CI's Node version comes from `.nvmrc`. `.nvmrc` is `24`, and every
// `actions/setup-node` step in every workflow reads it through `node-version-file` and never sets
// `node-version`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOWS = path.join(ROOT, ".github/workflows");

interface Step {
  uses?: unknown;
  with?: Record<string, unknown>;
}

interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

/** Every `actions/setup-node` step, labelled `<file> <job> #<index>`. */
function setupNodeSteps(): [string, Step][] {
  const found: [string, Step][] = [];
  const files = readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  for (const file of files) {
    const workflow = parse(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow | null;
    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      (job.steps ?? []).forEach((step, index) => {
        if (typeof step.uses === "string" && step.uses.startsWith("actions/setup-node@")) {
          found.push([`${file} ${jobName} #${String(index)}`, step]);
        }
      });
    }
  }
  return found;
}

describe("TP-0.25: CI's Node version comes from .nvmrc (A-87)", () => {
  it("TP-0.25: .nvmrc is 24", () => {
    expect(readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim()).toBe("24");
  });

  it("TP-0.25: the workflows have at least one actions/setup-node step", () => {
    expect(setupNodeSteps().length).toBeGreaterThan(0);
  });

  it.each(setupNodeSteps())(
    "TP-0.25: %s uses node-version-file: .nvmrc and no node-version",
    (_label, step) => {
      expect(step.with?.["node-version-file"]).toBe(".nvmrc");
      expect(step.with).not.toHaveProperty("node-version");
    },
  );
});
