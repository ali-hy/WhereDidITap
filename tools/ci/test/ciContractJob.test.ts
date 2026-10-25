// TP-4.1's CI part (S-4, CI step 2): the `contract` job runs on every pull request and fails on a
// stale openapi.json with `pnpm contract:openapi && git diff --exit-code`. The drift itself is
// tested in packages/contract/test/emitOpenapi.test.ts. TP-0.27: the breaking-change check runs the
// pinned, checksum-verified oasdiff release binary, not a Docker action (A-285).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  name?: unknown;
  if?: unknown;
  uses?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
}

interface Workflow {
  on?: Record<string, unknown> | string[] | string;
  jobs?: Record<string, { steps?: Step[] }>;
}

function ci(): Workflow {
  return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
}

describe("TP-4.1: the CI contract job", () => {
  it("TP-4.1: ci.yml runs on pull requests and has a contract job", () => {
    const workflow = ci();
    const triggers =
      typeof workflow.on === "string" ? [workflow.on] : Object.keys(workflow.on ?? {});

    expect(triggers).toContain("pull_request");
    expect(Object.keys(workflow.jobs ?? {})).toContain("contract");
  });

  it("TP-4.1: the contract job regenerates openapi.json and then runs git diff --exit-code", () => {
    const runs = (ci().jobs?.["contract"]?.steps ?? [])
      .map((s) => (typeof s.run === "string" ? s.run : ""))
      .join("\n");

    const generate = runs.indexOf("pnpm contract:openapi");
    const diff = runs.indexOf("git diff --exit-code");
    expect(generate).toBeGreaterThanOrEqual(0);
    expect(diff).toBeGreaterThan(generate);
  });
});

describe("TP-0.27: the contract job's oasdiff step (A-285)", () => {
  function steps(): Step[] {
    return ci().jobs?.["contract"]?.steps ?? [];
  }

  function oasdiffStep(): Step & { run: string } {
    const matching = steps().filter(
      (s): s is Step & { run: string } =>
        typeof s.run === "string" && s.run.includes("oasdiff") && /\bbreaking\b/.test(s.run),
    );
    expect(matching).toHaveLength(1);
    const [step] = matching;
    if (step === undefined) throw new Error("no oasdiff breaking step");
    return step;
  }

  /** "1.33.0" → [1, 33, 0]. */
  function semver(v: string): number[] {
    return v.split(".").map(Number);
  }

  function atLeast(v: number[], min: number[]): boolean {
    for (let i = 0; i < min.length; i += 1) {
      const a = v[i] ?? 0;
      const b = min[i] ?? 0;
      if (a !== b) return a > b;
    }
    return true;
  }

  it("TP-0.27: no step's uses: contains oasdiff", () => {
    const uses = steps()
      .map((s) => s.uses)
      .filter((u): u is string => typeof u === "string");

    expect(uses.filter((u) => u.includes("oasdiff"))).toEqual([]);
  });

  it("TP-0.27: exactly one step runs oasdiff breaking, under if: steps.base.outputs.exists == 'true'", () => {
    const step = oasdiffStep();

    expect(String(step.if).trim()).toBe("steps.base.outputs.exists == 'true'");
  });

  it("TP-0.27: OASDIFF_VERSION is semver and at least 1.33.0; OASDIFF_SHA256 is 64 lowercase hex characters", () => {
    const env = oasdiffStep().env ?? {};
    const version = String(env["OASDIFF_VERSION"]);
    const sha = String(env["OASDIFF_SHA256"]);

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(atLeast(semver(version), [1, 33, 0])).toBe(true);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("TP-0.27: the run downloads the linux_amd64 release from github.com/oasdiff/oasdiff, checks sha256sum -c against OASDIFF_SHA256 before tar, and runs breaking with --fail-on ERR and --allow-external-refs=false and without --open", () => {
    const run = oasdiffStep().run;
    const download = run.indexOf("https://github.com/oasdiff/oasdiff/releases/download/");
    const check = run.search(/sha256sum\s+-c/);
    // The tar command at the start of a line (".tar.gz" in the URL isn't it).
    const tar = run.search(/^\s*tar\s/m);
    const breaking = run.search(/oasdiff"?\s+breaking\b/);

    expect(download).toBeGreaterThanOrEqual(0);
    expect(run).toContain("oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz");
    expect(check).toBeGreaterThan(download);
    expect(run.slice(0, check + 80)).toContain("OASDIFF_SHA256");
    expect(tar).toBeGreaterThan(check);
    expect(breaking).toBeGreaterThan(tar);
    const call = run.slice(breaking);
    expect(call).toContain("--fail-on ERR");
    expect(call).toContain("--allow-external-refs=false");
    expect(run).not.toContain("--open");
  });

  it("TP-0.27: the step references no secrets.", () => {
    expect(JSON.stringify(oasdiffStep())).not.toContain("secrets.");
  });
});
