// TP-16.29 (A-483): rehearsal.yml uploads only after a finished scan. In both jobs a `scanned` step
// (if: always()) sits after `rehearse` and right before the upload; the upload's if, path and
// if-no-files-found are fixed; nothing uploads steps/ or .scan-staging/. The `scanned` script is
// run with bash against a temporary RUNNER_TEMP. TP-16.30 (A-497): only the doctored job generates a
// throwaway schema migration, before its images are built; nothing in the workflow can commit or
// push it. The `schema` script is run with bash and a fake pnpm.
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
  id?: unknown;
  name?: unknown;
  if?: unknown;
  uses?: unknown;
  run?: unknown;
  with?: Record<string, unknown>;
  env?: unknown;
  shell?: unknown;
  "working-directory"?: unknown;
  "continue-on-error"?: unknown;
}
const text = (v: unknown): string => (typeof v === "string" ? v : "");

interface Workflow {
  permissions?: unknown;
  jobs?: Record<string, { permissions?: unknown; steps?: Step[] }>;
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

// ---- TP-16.30 (A-497): the doctored job's throwaway schema migration ----

/** F-195 *Schema source for doctored runs*: the step's exact `run`. */
const SCHEMA_RUN = [
  'pnpm db:release-migration v0.0.0 || { echo "::error::throwaway schema migration failed (A-497)"; exit 1; }',
  '[ -f apps/server/drizzle/meta/_journal.json ] || { echo "::error::no schema source: apps/server/drizzle/meta/_journal.json is missing after generation (A-497)"; exit 1; }',
];

describe("TP-16.30: rehearsal.yml's doctored schema step (A-497)", () => {
  it("TP-16.30 (a): doctored has exactly one schema step, named, after the install and before the image builds, with exactly F-195's run and nothing else", () => {
    const all = steps("doctored");
    const schemas = all.flatMap((s, i) => (s.id === "schema" ? [i] : []));
    expect(schemas).toHaveLength(1);
    const at = schemas[0] ?? -1;
    const step = all[at] ?? {};
    const install = all.findIndex((s) => text(s.run).trim() === "pnpm install --frozen-lockfile");
    const images = all.findIndex((s) =>
      text(s.run).includes("docker build -f images/server/Dockerfile"),
    );

    expect(step.name).toBe("Throwaway schema migration (A-497)");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(images).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(install);
    expect(at).toBeLessThan(images);
    expect(all[images]?.name).toBe("The candidate's images");
    for (const key of ["if", "env", "shell", "working-directory", "continue-on-error"] as const) {
      expect(step[key], key).toBeUndefined();
    }
    expect(text(step.run)).toContain("pnpm db:release-migration v0.0.0");
    expect(text(step.run)).toContain("apps/server/drizzle/meta/_journal.json");
    expect(text(step.run).trimEnd().split("\n")).toEqual(SCHEMA_RUN);
  });

  it("TP-16.30 (b): the rehearsal job has no schema step and never generates a migration", () => {
    const all = steps("rehearsal");

    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((s) => s.id === "schema")).toEqual([]);
    const generating = all
      .map((s) => text(s.run))
      .filter((r) => /db:release-migration|drizzle-kit|apps\/server\/drizzle/.test(r));
    expect(generating).toEqual([]);
  });

  it("TP-16.30 (c): contents: read only, no job permissions, checkouts without credentials, and no git add, commit or push", () => {
    const wf = workflow();
    const jobs = Object.entries(wf.jobs ?? {});
    const all = jobs.flatMap(([, j]) => j.steps ?? []);
    const checkouts = all.filter((s) => text(s.uses).startsWith("actions/checkout@"));

    expect(wf.permissions).toEqual({ contents: "read" });
    expect(jobs.filter(([, j]) => j.permissions !== undefined).map(([name]) => name)).toEqual([]);
    expect(checkouts.length).toBeGreaterThanOrEqual(2);
    for (const c of checkouts) expect(c.with?.["persist-credentials"]).toBe(false);
    expect(all.map((s) => text(s.run)).filter((r) => /\bgit (add|commit|push)\b/.test(r))).toEqual(
      [],
    );
  });
});

describe("TP-16.30: the schema script with a fake pnpm (A-497)", () => {
  let base: string | undefined;
  afterEach(() => {
    if (base !== undefined) rmSync(base, { recursive: true, force: true });
    base = undefined;
  });

  type Fake = "generates" | "nothing" | "fails";

  /** Runs the schema step's `run` in a temp checkout with a fake pnpm first on PATH. */
  function runSchema(fake: Fake, journalBefore: boolean) {
    base = mkdtempSync(path.join(tmpdir(), "budmon-tp16-30-"));
    const work = path.join(base, "work");
    const bin = path.join(base, "bin");
    const calls = path.join(base, "pnpm-calls");
    const drizzle = path.join(work, "apps/server/drizzle");
    mkdirSync(path.join(drizzle, "meta"), { recursive: true });
    mkdirSync(bin);
    if (journalBefore) writeFileSync(path.join(drizzle, "meta/_journal.json"), "{}\n");
    const action = {
      generates: [
        `printf '{}\\n' > "${path.join(drizzle, "meta/_journal.json")}"`,
        `printf 'CREATE TABLE x ();\\n' > "${path.join(drizzle, "0000_v0.0.0.sql")}"`,
        `echo "${path.join(drizzle, "0000_v0.0.0.sql")}"`,
        "exit 0",
      ],
      nothing: ["exit 0"],
      fails: ["exit 1"],
    }[fake];
    writeFileSync(
      path.join(bin, "pnpm"),
      ["#!/bin/sh", `echo "$*" >> "${calls}"`, ...action, ""].join("\n"),
    );
    chmodSync(path.join(bin, "pnpm"), 0o755);
    const script = text(steps("doctored").find((s) => s.id === "schema")?.run);
    const r = spawnSync("bash", ["-c", script], {
      cwd: work,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      timeout: 30_000,
    });
    const recorded = existsSync(calls) ? readFileSync(calls, "utf8") : "";
    return { r, calls: recorded };
  }

  it("TP-16.30 (i): no journal, the generator writes it: exit 0, one call db:release-migration v0.0.0, no ::error::", () => {
    const { r, calls } = runSchema("generates", false);

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(calls).toBe("db:release-migration v0.0.0\n");
    expect(r.stdout).not.toContain("::error::");
  });

  it("TP-16.30 (ii): the journal already there and nothing generated: exit 0, one call", () => {
    const { r, calls } = runSchema("nothing", true);

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(calls).toBe("db:release-migration v0.0.0\n");
  });

  it("TP-16.30 (iii): no journal and nothing generated: exit 1, ::error::no schema source:", () => {
    const { r, calls } = runSchema("nothing", false);

    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^::error::no schema source:/m);
    expect(calls).toBe("db:release-migration v0.0.0\n");
  });

  it("TP-16.30 (iv): pnpm failing: exit 1, only the throwaway-migration error", () => {
    const { r } = runSchema("fails", false);

    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^::error::throwaway schema migration failed \(A-497\)/m);
    expect(r.stdout).not.toMatch(/^::error::no schema source:/m);
  });
});
