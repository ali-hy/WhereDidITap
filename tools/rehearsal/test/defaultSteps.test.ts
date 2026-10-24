// Default steps with a recording fake exec, every other step replaced (in the style of TP-16.16):
// step 10's fail-closed isolation probe (TP-16.7x, B-1) and the default cleanup's A-478 (4) scope
// (TP-16.24x, B-2). Nothing here runs a child process.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadRun,
  type Exec,
  type ExecOptions,
  type RehearsalOptions,
  type RunModule,
  type StepFn,
  type StepName,
} from "./support/load.js";

let m: RunModule;
let workDir: string;
beforeAll(async () => {
  m = await loadRun();
  workDir = mkdtempSync(path.join(tmpdir(), "budmon-tp16-7x-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const opts = (dir: string): RehearsalOptions => ({
  previousTag: null,
  version: "v1.0.0",
  images: { server: "budmon/server:rc", web: "budmon/web:rc", postgres: "budmon/postgres:rc" },
  workDir: dir,
  repoRoot: dir,
});

interface Call {
  cmd: string;
  args: string[];
  o: ExecOptions;
}

function recordingExec(answer: (c: Call) => { code: number; stdout: string } = () => ok0) {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, o) => {
    const call = { cmd, args, o };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { exec, calls };
}
const ok0 = { code: 0, stdout: "" };
const okStep: StepFn = () => Promise.resolve({ ok: true, detail: "" });

/** Every step but `keep` replaced by an ok fake; artifacts (and cleanup unless `realCleanup`) too. */
async function run(dir: string, exec: Exec, keep: StepName | null, realCleanup = false) {
  const steps = Object.fromEntries(
    m.STEP_ORDER.filter((n) => n !== keep).map((n) => [n, okStep]),
  ) as Partial<Record<StepName, StepFn>>;
  return m.runRehearsal(opts(dir), {
    exec,
    steps,
    sleep: () => Promise.resolve(),
    collectArtifacts: okStep,
    ...(realCleanup ? {} : { cleanup: okStep }),
  });
}

const record = (steps: { name: string; ok: boolean; detail: string }[], name: string) =>
  steps.find((s) => s.name === name);

// ---- B-1: step 10's probe ----

/** The probe: `docker compose … exec -T worker-capture node -e … <ip>`. */
const isProbe = (c: Call) =>
  c.cmd === "docker" && c.args.includes("exec") && c.args.includes("worker-capture");

function writeLocalEnv(line: string) {
  const release = path.join(workDir, "home", "releases", "rehearsal");
  mkdirSync(release, { recursive: true });
  writeFileSync(path.join(release, "local.env"), `BUDMON_TAG=rehearsal\n${line}\nOTHER=1\n`);
}

/** No containers (so no cross-role mounts); the probe exits `probeCode`. */
function probeExec(probeCode: number) {
  return recordingExec((c) => (isProbe(c) ? { code: probeCode, stdout: "" } : ok0));
}

describe("TP-16.7x: cross-role-secrets fails closed unless the probe was refused or timed out (B-1)", () => {
  it.each([
    ["empty", "PG_DATA_IP="],
    ["three octets", "PG_DATA_IP=10.0.0"],
    ["an octet above 255", "PG_DATA_IP=256.1.1.1"],
  ])(
    "TP-16.7x: PG_DATA_IP %s → isolation_probe_failed, and the probe never runs",
    async (_l, line) => {
      writeLocalEnv(line);
      const { exec, calls } = probeExec(2);

      const result = await run(workDir, exec, "cross-role-secrets");

      expect(record(result.steps, "cross-role-secrets")).toEqual({
        name: "cross-role-secrets",
        ok: false,
        detail: "isolation_probe_failed",
      });
      expect(calls.filter(isProbe)).toEqual([]);
      // Only the two container listings ran.
      expect(calls.map((c) => [c.cmd, c.args[0]])).toEqual([
        ["docker", "ps"],
        ["docker", "ps"],
      ]);
    },
  );

  it.each([1, 125, 126, 127])("TP-16.7x: probe exit %i → isolation_probe_failed", async (code) => {
    writeLocalEnv("PG_DATA_IP=172.30.0.5");
    const { exec, calls } = probeExec(code);

    const result = await run(workDir, exec, "cross-role-secrets");

    expect(record(result.steps, "cross-role-secrets")?.detail).toBe("isolation_probe_failed");
    expect(record(result.steps, "cross-role-secrets")?.ok).toBe(false);
    expect(calls.filter(isProbe)).toHaveLength(1);
  });

  it.each([2, 3])("TP-16.7x: probe exit %i (timeout or refused) → ok", async (code) => {
    writeLocalEnv("PG_DATA_IP=172.30.0.5");
    const { exec, calls } = probeExec(code);

    const result = await run(workDir, exec, "cross-role-secrets");

    expect(record(result.steps, "cross-role-secrets")?.ok).toBe(true);
    const probes = calls.filter(isProbe);
    expect(probes).toHaveLength(1);
    // The probe targets the IP from local.env, as its last argument.
    expect(probes[0]?.args.at(-1)).toBe("172.30.0.5");
  });

  it("TP-16.7x: probe exit 0 → capture_reaches_data", async () => {
    writeLocalEnv("PG_DATA_IP=172.30.0.5");
    const { exec } = probeExec(0);

    const result = await run(workDir, exec, "cross-role-secrets");

    expect(record(result.steps, "cross-role-secrets")).toEqual({
      name: "cross-role-secrets",
      ok: false,
      detail: "capture_reaches_data",
    });
  });
});

// ---- B-2: the default cleanup ----

const LAPTOP = ["budmon-main", "budmon-capture", "budmon_capture_db"];

describe("TP-16.24x: the default cleanup touches only the rehearsal's projects, network and work directory (A-478)", () => {
  const dir = "/tmp/budmon-rehearsal-tp16-24x";

  it("TP-16.24x (a) to (d): two down -v calls with -p budmon-rehearsal-*, one network rm, one sudo rm -rf of home and capture-key, no laptop name", async () => {
    const { exec, calls } = recordingExec();

    const result = await run(dir, exec, null, true);

    expect(record(result.steps, "cleanup")).toEqual({ name: "cleanup", ok: true, detail: "" });
    const cleanup = calls.filter((c) => c.o.step === "cleanup");
    expect(cleanup).toEqual(calls);

    // (a)
    const downs = cleanup.filter(
      (c) =>
        c.cmd === "docker" &&
        c.args[0] === "compose" &&
        c.args.includes("down") &&
        c.args.includes("-v") &&
        c.args.includes("--remove-orphans"),
    );
    expect(downs).toHaveLength(2);
    const projectOf = (c: Call) => c.args[c.args.indexOf("-p") + 1];
    expect(downs.map(projectOf).sort()).toEqual([
      "budmon-rehearsal-capture",
      "budmon-rehearsal-main",
    ]);
    expect(cleanup.filter((c) => c.args.includes("down"))).toHaveLength(2);

    // (b)
    const networkRm = cleanup.filter(
      (c) => c.cmd === "docker" && c.args[0] === "network" && c.args[1] === "rm",
    );
    expect(networkRm.map((c) => c.args)).toEqual([
      ["network", "rm", "budmon_rehearsal_capture_db"],
    ]);

    // (c)
    const sudo = cleanup.filter((c) => c.cmd === "sudo");
    expect(sudo.map((c) => c.args)).toEqual([["rm", "-rf", `${dir}/home`, `${dir}/capture-key`]]);

    // (d)
    const offending = calls.flatMap((c) =>
      [c.cmd, ...c.args].filter((a) => LAPTOP.some((name) => a.includes(name))),
    );
    expect(offending).toEqual([]);
  });

  // The review's example, "/tmp/w/", becomes safe once root is built from path.resolve(workDir)
  // (its optional point); "/" and "" give paths outside any work directory either way.
  it.each([
    ["the filesystem root", "/"],
    ["an empty string", ""],
  ])("TP-16.24x (e): a workDir of %s → cleanup: unsafe_path, and no sudo call", async (_l, dir) => {
    const { exec, calls } = recordingExec();

    const result = await run(dir, exec, null, true);

    expect(record(result.steps, "cleanup")).toEqual({
      name: "cleanup",
      ok: false,
      detail: "cleanup: unsafe_path",
    });
    expect(calls.filter((c) => c.cmd === "sudo")).toEqual([]);
    expect(result.ok).toBe(false);
  });
});
