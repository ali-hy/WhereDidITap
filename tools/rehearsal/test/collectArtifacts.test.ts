// F-195's default collectArtifacts (A-476, A-483): raw step logs live in <workDir>/steps, outside
// the uploaded tree. It rescans every source, the step logs last, builds the upload in
// <workDir>/.scan-staging (a source with a hit as one withheld line, names only in
// scan-report.json, written last) and renames it to <workDir>/artifacts only after a complete scan;
// any throw leaves neither tree. TP-16.26 (rewritten for A-483) and TP-16.28.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANARIES } from "@budmon/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadRun,
  type Exec,
  type ExecOptions,
  type RunModule,
  type StepFn,
  type StepName,
} from "./support/load.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OLD = "OLDpassword-0123456789ab";
const NEW = "NEWpassword-0123456789ab";

let m: RunModule;
let workDir: string;
const raw = () => path.join(workDir, "steps");
const uploaded = () => path.join(workDir, "artifacts");
const staging = () => path.join(workDir, ".scan-staging");

beforeAll(async () => {
  m = await loadRun();
});
beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "budmon-tp16-26-"));
  mkdirSync(raw(), { recursive: true });
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

interface Call {
  cmd: string;
  args: string[];
  o: ExecOptions;
}

/**
 * The artifacts step's commands, answered as a stack with one clean api container would; with
 * `rejectListing`, the container listing rejects with `new Error("x")`.
 */
function fakeExec(rejectListing = false) {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, o) => {
    calls.push({ cmd, args, o });
    const all = args.join(" ");
    if (cmd === "docker" && args[0] === "ps") {
      if (rejectListing) return Promise.reject(new Error("x"));
      return Promise.resolve({
        code: 0,
        stdout: all.includes("budmon-rehearsal-main") ? "c-api\n" : "",
      });
    }
    if (cmd === "docker" && args[0] === "inspect") {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify([
          { Config: { Labels: { "com.docker.compose.service": "api" }, Env: [] }, Mounts: [] },
        ]),
      });
    }
    if (all.includes("logs")) return Promise.resolve({ code: 0, stdout: "api started\n" });
    return Promise.resolve({ code: 0, stdout: "" });
  };
  return { exec, calls };
}

const SMOKE_CLEAN = "### pnpm (step smoke)\nok\n";
const ROLLBACK_CLEAN = "### docker (step rollback)\nclean\n";
const SMOKE_LEAK = `### pnpm (step smoke)\n${CANARIES.token}\n`;
const ROLLBACK_LEAK = `### docker (step rollback)\n${Buffer.from(NEW).toString("base64")}\n`;

function writeRaw(name: string, text: string) {
  writeFileSync(path.join(raw(), name), text);
}

interface RunOptions {
  leaks?: boolean;
  shortNeedle?: boolean;
  rejectListing?: boolean;
  /** Replaces the recording cleanup with one that also writes <workDir>/steps/cleanup.log. */
  cleanupWritesLog?: boolean;
}

async function run(o: RunOptions = {}) {
  writeRaw("smoke.log", o.leaks === true ? SMOKE_LEAK : SMOKE_CLEAN);
  writeRaw("rollback.log", o.leaks === true ? ROLLBACK_LEAK : ROLLBACK_CLEAN);
  const { exec, calls } = fakeExec(o.rejectListing === true);
  let cleanups = 0;
  const replaced = Object.fromEntries(
    m.STEP_ORDER.map((n) => [
      n,
      ((ctx) => {
        if (n === "gate-commands") {
          ctx.needles.push({ name: "migrator-password-old", value: OLD });
          ctx.needles.push({ name: "migrator-password-new", value: NEW });
          if (o.shortNeedle === true) ctx.needles.push({ name: "short", value: "abc" });
        }
        return Promise.resolve({ ok: true, detail: "" });
      }) satisfies StepFn,
    ]),
  ) as Partial<Record<StepName, StepFn>>;
  const result = await m.runRehearsal(
    {
      previousTag: null,
      version: "v1.0.0",
      images: { server: "s", web: "w", postgres: "p" },
      workDir,
      repoRoot: workDir,
    },
    {
      exec,
      http: () => Promise.reject(new Error("no http")),
      steps: replaced,
      cleanup: () => {
        cleanups += 1;
        if (o.cleanupWritesLog === true) {
          writeRaw("cleanup.log", `### docker (step cleanup)\n${CANARIES.token}\n`);
        }
        return Promise.resolve({ ok: true, detail: "" });
      },
    },
  );
  return { result, calls, cleanups, artifacts: result.steps.find((s) => s.name === "artifacts") };
}

/** Every file under `dir`, relative, sorted. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

describe("TP-16.26: collectArtifacts rescans and withholds (A-476, A-483)", () => {
  it("TP-16.26: hits in two step logs: leak detail by name, both uploaded copies withheld, the raw files unchanged, the report has names only, no staging tree, every exec sensitive, cleanup still runs", async () => {
    const { result, calls, cleanups, artifacts } = await run({ leaks: true });

    expect(artifacts).toEqual({
      name: "artifacts",
      ok: false,
      detail: "leak: steps/rollback.log:migrator-password-new, steps/smoke.log:token",
    });
    for (const file of ["smoke.log", "rollback.log"]) {
      const text = readFileSync(path.join(uploaded(), "steps", file), "utf8");
      const lines = text.split("\n").filter((l) => l !== "");
      expect(lines, file).toHaveLength(1);
      expect(lines[0], file).toMatch(/^withheld: 1 hit\(s\):/);
      for (const value of [CANARIES.token, NEW, Buffer.from(NEW).toString("base64")]) {
        expect(text, file).not.toContain(value);
      }
    }
    expect(readFileSync(path.join(raw(), "smoke.log"), "utf8")).toBe(SMOKE_LEAK);
    expect(readFileSync(path.join(raw(), "rollback.log"), "utf8")).toBe(ROLLBACK_LEAK);
    const report = readFileSync(path.join(uploaded(), "scan-report.json"), "utf8");
    const parsed = JSON.parse(report) as { final: { source: string; name: string }[] };
    expect(parsed.final.map((h) => `${h.source}:${h.name}`).sort()).toEqual([
      "steps/rollback.log:migrator-password-new",
      "steps/smoke.log:token",
    ]);
    for (const value of [CANARIES.token, NEW, OLD]) expect(report).not.toContain(value);
    expect(existsSync(staging())).toBe(false);
    const artifactCalls = calls.filter((c) => c.o.step === "artifacts");
    expect(artifactCalls.length).toBeGreaterThan(0);
    for (const c of artifactCalls) {
      expect(c.o.sensitiveStdout, [c.cmd, ...c.args].join(" ")).toBe(true);
    }
    expect(cleanups).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("TP-16.26: clean step logs: artifacts ok, and the uploaded copies byte-identical to the raw files", async () => {
    const { artifacts } = await run();

    expect(artifacts).toEqual({ name: "artifacts", ok: true, detail: "" });
    for (const file of readdirSync(raw()).filter((f) => f.endsWith(".log"))) {
      expect(readFileSync(path.join(uploaded(), "steps", file), "utf8"), file).toBe(
        readFileSync(path.join(raw(), file), "utf8"),
      );
    }
    expect(readFileSync(path.join(raw(), "smoke.log"), "utf8")).toBe(SMOKE_CLEAN);
    expect(readFileSync(path.join(raw(), "rollback.log"), "utf8")).toBe(ROLLBACK_CLEAN);
  });
});

describe("TP-16.28: collectArtifacts fails closed, and rehearsalPaths (A-483)", () => {
  const OWN_AND_CLEANUP = ["artifacts.log", "artifacts--x.log", "cleanup.log", "cleanup--y.log"];
  const writeOwnAndCleanup = () => {
    for (const name of OWN_AND_CLEANUP) writeRaw(name, `### x\n${CANARIES.token}\n`);
  };

  it("TP-16.28 (a): rehearsalPaths(/w)", () => {
    expect(m.rehearsalPaths("/w")).toEqual({
      stepLogs: "/w/steps",
      artifacts: "/w/artifacts",
      staging: "/w/.scan-staging",
    });
  });

  it("TP-16.28 (b): its own and cleanup's logs are never copied; the report is final: []", async () => {
    writeOwnAndCleanup();

    const { artifacts } = await run();

    expect(artifacts).toEqual({ name: "artifacts", ok: true, detail: "" });
    expect(JSON.parse(readFileSync(path.join(uploaded(), "scan-report.json"), "utf8"))).toEqual({
      final: [],
    });
    expect(tree(path.join(uploaded(), "steps"))).toEqual(["rollback.log", "smoke.log"]);
    for (const name of OWN_AND_CLEANUP) {
      expect(existsSync(path.join(uploaded(), "steps", name)), name).toBe(false);
    }
  });

  it("TP-16.28 (c): a stale artifacts/ and .scan-staging/ are cleared first", async () => {
    writeOwnAndCleanup();
    mkdirSync(uploaded(), { recursive: true });
    writeFileSync(path.join(uploaded(), "stale.log"), `${CANARIES.token}\n`);
    mkdirSync(staging(), { recursive: true });
    writeFileSync(path.join(staging(), "old.log"), `${CANARIES.token}\n`);

    const { artifacts } = await run();

    expect(artifacts).toEqual({ name: "artifacts", ok: true, detail: "" });
    expect(existsSync(path.join(uploaded(), "stale.log"))).toBe(false);
    expect(existsSync(staging())).toBe(false);
    expect(tree(uploaded())).not.toContain("stale.log");
    expect(tree(path.join(uploaded(), "steps"))).toEqual(["rollback.log", "smoke.log"]);
  });

  it("TP-16.28 (d): a 3-character needle (scanForNeedles throws TypeError) → error: TypeError, neither tree left, cleanup still called", async () => {
    const { artifacts, cleanups } = await run({ shortNeedle: true });

    expect(artifacts).toEqual({ name: "artifacts", ok: false, detail: "error: TypeError" });
    expect(existsSync(uploaded())).toBe(false);
    expect(existsSync(staging())).toBe(false);
    expect(cleanups).toBe(1);
  });

  it("TP-16.28 (e): the container listing rejecting with Error → error: Error, neither tree left", async () => {
    const { artifacts, cleanups } = await run({ rejectListing: true });

    expect(artifacts).toEqual({ name: "artifacts", ok: false, detail: "error: Error" });
    expect(existsSync(uploaded())).toBe(false);
    expect(existsSync(staging())).toBe(false);
    expect(cleanups).toBe(1);
  });

  it("TP-16.28 (f): cleanup writing steps/cleanup.log afterwards never reaches the upload", async () => {
    const { artifacts } = await run({ cleanupWritesLog: true });

    expect(artifacts).toEqual({ name: "artifacts", ok: true, detail: "" });
    expect(readFileSync(path.join(raw(), "cleanup.log"), "utf8")).toContain(CANARIES.token);
    expect(existsSync(path.join(uploaded(), "steps", "cleanup.log"))).toBe(false);
    for (const file of tree(uploaded())) {
      expect(readFileSync(path.join(uploaded(), file), "utf8"), file).not.toContain(CANARIES.token);
    }
  });

  it("TP-16.28 (g): cli.ts passes rehearsalPaths(…).stepLogs to createLoggingExec and has no artifacts/steps literal", () => {
    const cli = readFileSync(path.join(HERE, "../src/cli.ts"), "utf8");

    expect(cli).toMatch(/\{\s*stepLogs\s*\}\s*=\s*rehearsalPaths\(\s*workDir\s*\)/);
    expect(cli).toMatch(/createLoggingExec\(\s*stepLogs\s*\)/);
    expect(cli.match(/createLoggingExec\(/g)).toHaveLength(1);
    expect(cli).not.toContain("artifacts/steps");
    expect(cli).not.toMatch(/["']artifacts["']\s*,\s*["']steps["']/);
  });
});
