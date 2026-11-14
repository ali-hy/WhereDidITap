// TP-0.19: `ci.yml`'s `migrations` job feeds F-6 (A-7, A-16, A-28).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  run?: string;
  "working-directory"?: string;
}

interface Job {
  if?: string;
  steps?: Step[];
}

interface Workflow {
  on?: { pull_request?: { types?: string[] } | null };
  jobs?: Record<string, Job>;
}

function workflow(): Workflow {
  return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
}

function migrationsJob(): Job {
  const job = workflow().jobs?.["migrations"];
  if (job === undefined) throw new Error("ci.yml has no `migrations` job");
  return job;
}

function steps(): Step[] {
  return migrationsJob().steps ?? [];
}

function f6Step(): Step {
  const step = steps().find((s) => s.run?.includes("checkMigrationFiles.ts") === true);
  if (step === undefined) throw new Error("No step runs checkMigrationFiles.ts");
  return step;
}

describe("TP-0.19: ci.yml migrations job wiring", () => {
  it("TP-0.19: pull_request triggers include opened, synchronize, reopened, labeled and unlabeled", () => {
    expect(workflow().on?.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "labeled", "unlabeled"]),
    );
  });

  it("TP-0.19: the job's if restricts it to pull_request events", () => {
    expect(migrationsJob().if?.replace(/\s+/g, " ")).toMatch(
      /github\.event_name == ['"]pull_request['"]/,
    );
  });

  it("TP-0.19: checkout uses fetch-depth 0", () => {
    const checkout = steps().find((s) => s.uses?.startsWith("actions/checkout@") === true);

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("TP-0.19: a step lists changed files with git -c core.quotePath=false and a three-dot diff against origin/${BASE_REF}", () => {
    const diffStep = steps().find(
      (s) => s.run?.includes("git -c core.quotePath=false diff --no-renames --name-only") === true,
    );

    expect(diffStep?.run).toMatch(
      /git -c core\.quotePath=false diff --no-renames --name-only "?origin\/\$\{BASE_REF\}\.\.\.HEAD"?/,
    );
    expect(String(diffStep?.env?.["BASE_REF"]).replace(/\s+/g, "")).toBe("${{github.base_ref}}");
  });

  it("TP-0.19: the F-6 step gets HEAD_REF from github.head_ref through env", () => {
    expect(String(f6Step().env?.["HEAD_REF"]).replace(/\s+/g, "")).toBe("${{github.head_ref}}");
  });

  it("TP-0.19: the F-6 step's MERGE_BACK tests both merge-back labels", () => {
    const mergeBack = String(f6Step().env?.["MERGE_BACK"]);

    expect(mergeBack).toContain("hotfix-merge-back");
    expect(mergeBack).toContain("infra-merge-back");
  });

  it('TP-0.19: the F-6 step passes --branch "$HEAD_REF" and --changed-files', () => {
    const run = f6Step().run ?? "";

    expect(run).toContain('--branch "$HEAD_REF"');
    expect(run).toContain("--changed-files");
  });

  it("TP-0.19: the F-6 step runs in tools/ci through ./node_modules/.bin/tsx, without pnpm (A-28)", () => {
    const step = f6Step();

    expect(step["working-directory"]).toBe("tools/ci");
    expect(step.run).toContain("./node_modules/.bin/tsx checkMigrationFiles.ts");
    expect(step.run).not.toContain("pnpm");
  });

  it("TP-0.19: no run in the job interpolates the head ref or pull request fields", () => {
    const runs = steps().map((s) => (s.run ?? "").replace(/\{\{\s+/g, "{{"));

    for (const run of runs) {
      expect(run).not.toContain("${{github.head_ref");
      expect(run).not.toContain("${{github.event.pull_request");
    }
  });

  // The F-6 step's script, run the way GitHub Actions runs `run:` (bash -eo pipefail) in the
  // step's working directory, with a stub `./node_modules/.bin/tsx` there that records its
  // arguments one per line.
  describe("TP-0.19: the F-6 step's script passes the values through", () => {
    let dir = "";

    afterEach(() => {
      if (dir !== "") rmSync(dir, { recursive: true, force: true });
      dir = "";
    });

    function runStep(env: { HEAD_REF: string; MERGE_BACK: string }): string[] {
      dir = mkdtempSync(path.join(tmpdir(), "budmon-ci-step-"));
      const workingDirectory = path.join(dir, f6Step()["working-directory"] ?? ".");
      const bin = path.join(workingDirectory, "node_modules", ".bin");
      const record = path.join(dir, "tsx-args.txt");
      const script = path.join(dir, "step.sh");
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        path.join(bin, "tsx"),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`,
      );
      chmodSync(path.join(bin, "tsx"), 0o755);
      writeFileSync(script, f6Step().run ?? "");

      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
        cwd: workingDirectory,
        encoding: "utf8",
        env: { ...process.env, ...env, RUNNER_TEMP: dir },
      });
      expect(result.status, result.stderr).toBe(0);
      return readFileSync(record, "utf8").split("\n").slice(0, -1);
    }

    function expectedArgs(branch: string, hotfix: boolean): string[] {
      return [
        "checkMigrationFiles.ts",
        "--branch",
        branch,
        "--changed-files",
        path.join(dir, "changed-files.txt"),
        ...(hotfix ? ["--hotfix-merge-back"] : []),
      ];
    }

    it("TP-0.19: MERGE_BACK=true adds --hotfix-merge-back", () => {
      const args = runStep({ HEAD_REF: "hotfix/v1.0.1", MERGE_BACK: "true" });

      expect(args).toEqual(expectedArgs("hotfix/v1.0.1", true));
    });

    it("TP-0.19: MERGE_BACK=false passes no --hotfix-merge-back", () => {
      const args = runStep({ HEAD_REF: "feat/x", MERGE_BACK: "false" });

      expect(args).toEqual(expectedArgs("feat/x", false));
    });

    it("TP-0.19: a branch name with shell syntax reaches --branch as one literal argument", () => {
      const branch = 'feat/$(touch pwned)";x y';

      const args = runStep({ HEAD_REF: branch, MERGE_BACK: "false" });

      expect(args).toEqual(expectedArgs(branch, false));
      expect(existsSync(path.join(dir, "pwned"))).toBe(false);
    });
  });
});
