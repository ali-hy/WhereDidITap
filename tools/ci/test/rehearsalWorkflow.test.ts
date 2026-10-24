// TP-16.29 (A-483): rehearsal.yml uploads only after a finished scan. In both jobs a `scanned` step
// (if: always()) sits after `rehearse` and right before the upload; the upload's if, path and
// if-no-files-found are fixed; nothing uploads steps/ or .scan-staging/. The `scanned` script is
// run with bash against a temporary RUNNER_TEMP.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  id?: unknown;
  name?: unknown;
  if?: unknown;
  uses?: unknown;
  run?: unknown;
  with?: Record<string, unknown>;
}
const text = (v: unknown): string => (typeof v === "string" ? v : "");

interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

function workflow(): Workflow {
  return parse(
    readFileSync(path.join(ROOT, ".github/workflows/rehearsal.yml"), "utf8"),
  ) as Workflow;
}
function steps(job: string): Step[] {
  return workflow().jobs?.[job]?.steps ?? [];
}
const isUpload = (s: Step) =>
  typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@");

const JOBS = ["rehearsal", "doctored"];

describe("TP-16.29: rehearsal.yml's upload gate (A-483)", () => {
  it.each(JOBS)(
    "TP-16.29: %s: scanned (if: always()) comes after rehearse and right before the upload",
    (job) => {
      const all = steps(job);
      const rehearse = all.findIndex((s) => s.id === "rehearse");
      const scanned = all.findIndex((s) => s.id === "scanned");
      const uploads = all.flatMap((s, i) => (isUpload(s) ? [i] : []));

      expect(rehearse).toBeGreaterThanOrEqual(0);
      expect(scanned).toBeGreaterThan(rehearse);
      expect(all[scanned]?.if).toBe("always()");
      expect(uploads).toEqual([scanned + 1]);
    },
  );

  it.each(JOBS)("TP-16.29: %s: the upload's if, path and if-no-files-found are fixed", (job) => {
    const upload = steps(job).find(isUpload);

    expect(upload?.if).toBe("always() && steps.scanned.outputs.ok == 'true'");
    expect(upload?.with?.["path"]).toBe("${{ runner.temp }}/budmon-rehearsal-*/artifacts/");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
  });

  it("TP-16.29: no step in any job uploads a path containing steps or .scan-staging", () => {
    const offending = Object.entries(workflow().jobs ?? {}).flatMap(([job, j]) =>
      (j.steps ?? [])
        .filter(isUpload)
        .map((s) => text(s.with?.["path"]))
        .filter((p) => /(^|\/)steps(\/|$)|\.scan-staging/.test(p))
        .map((p) => `${job}: ${p}`),
    );

    expect(offending).toEqual([]);
  });
});

describe("TP-16.29: the scanned script (A-483)", () => {
  let base: string | undefined;
  afterEach(() => {
    if (base !== undefined) rmSync(base, { recursive: true, force: true });
    base = undefined;
  });

  function runScript(job: string, files: string[]) {
    base = mkdtempSync(path.join(tmpdir(), "budmon-tp16-29-"));
    const runnerTemp = path.join(base, "runner");
    mkdirSync(runnerTemp);
    for (const file of files) {
      mkdirSync(path.dirname(path.join(runnerTemp, file)), { recursive: true });
      writeFileSync(path.join(runnerTemp, file), "{}\n");
    }
    const output = path.join(base, "github_output");
    writeFileSync(output, "");
    const script = text(steps(job).find((s) => s.id === "scanned")?.run);
    const r = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: output },
      timeout: 30_000,
    });
    return { r, output: readFileSync(output, "utf8") };
  }

  const cases: [string, string[], boolean][] = [
    ["(i) no budmon-rehearsal-* directory → ok=false", [], false],
    [
      "(ii) only steps/ and .scan-staging/ → ok=false",
      ["budmon-rehearsal-a/steps/x.log", "budmon-rehearsal-a/.scan-staging/scan-report.json"],
      false,
    ],
    ["(iii) exactly one report → ok=true", ["budmon-rehearsal-a/artifacts/scan-report.json"], true],
    [
      "(iv) two reports → ok=false",
      [
        "budmon-rehearsal-a/artifacts/scan-report.json",
        "budmon-rehearsal-b/artifacts/scan-report.json",
      ],
      false,
    ],
  ];

  for (const job of JOBS) {
    it.each(cases)(`TP-16.29: ${job}: %s, and exit 0`, (_label, files, ok) => {
      const { r, output } = runScript(job, files);

      expect(r.error, String(r.error)).toBeUndefined();
      expect(r.status, r.stderr).toBe(0);
      expect(output).toBe(`ok=${String(ok)}\n`);
      if (ok) expect(r.stdout).not.toContain("::warning::");
      else expect(r.stdout).toMatch(/^::warning::/m);
    });
  }
});
