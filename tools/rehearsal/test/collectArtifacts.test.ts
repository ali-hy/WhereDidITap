// F-195's default collectArtifacts (A-476): it rescans every source, the step logs last, and
// withholds any file with a hit, recording names only. TP-16.26.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

const ORDER: StepName[] = [
  "secrets",
  "previous-db",
  "migrate",
  "stack-up",
  "ready",
  "upgrade-assertions",
  "canary-flows",
  "scan",
  "mailpit-quiet",
  "no-stage-setting",
  "cross-role-secrets",
  "gate-commands",
  "maintenance",
  "rollback",
  "smoke",
];
const OLD = "OLDpassword-0123456789ab";
const NEW = "NEWpassword-0123456789ab";

let m: RunModule;
let workDir: string;
const steps = () => path.join(workDir, "artifacts", "steps");

beforeAll(async () => {
  m = await loadRun();
});
beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "budmon-tp16-26-"));
  mkdirSync(steps(), { recursive: true });
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** The artifacts step's commands, answered as a stack with one clean api container would. */
function fakeExec() {
  const calls: { cmd: string; args: string[]; o: ExecOptions }[] = [];
  const exec: Exec = (cmd, args, o) => {
    calls.push({ cmd, args, o });
    const all = args.join(" ");
    if (cmd === "mkdir") {
      mkdirSync(args[args.length - 1] ?? "", { recursive: true });
      return Promise.resolve({ code: 0, stdout: "" });
    }
    if (cmd === "install" && args.includes("/dev/stdin")) {
      const file = args[args.length - 1] ?? "";
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, o.input ?? "");
      return Promise.resolve({ code: 0, stdout: "" });
    }
    if (cmd === "docker" && args[0] === "ps") {
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

async function run(withLeaks: boolean) {
  writeFileSync(
    path.join(steps(), "smoke.log"),
    withLeaks ? `### pnpm (step smoke)\n${CANARIES.token}\n` : "### pnpm (step smoke)\nok\n",
  );
  writeFileSync(
    path.join(steps(), "rollback.log"),
    withLeaks
      ? `### docker (step rollback)\n${Buffer.from(NEW).toString("base64")}\n`
      : "### docker (step rollback)\nclean\n",
  );
  const { exec, calls } = fakeExec();
  let cleanups = 0;
  const replaced = Object.fromEntries(
    ORDER.map((n) => [
      n,
      ((ctx) => {
        if (n === "gate-commands") {
          ctx.needles.push({ name: "migrator-password-old", value: OLD });
          ctx.needles.push({ name: "migrator-password-new", value: NEW });
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
        return Promise.resolve({ ok: true, detail: "" });
      },
    },
  );
  return { result, calls, cleanups };
}

describe("TP-16.26: collectArtifacts rescans and withholds (A-476)", () => {
  it("TP-16.26: hits in two step logs: leak detail by name, both files withheld, the report has names only, every exec sensitive, cleanup still runs", async () => {
    const { result, calls, cleanups } = await run(true);

    expect(result.steps.find((s) => s.name === "artifacts")).toEqual({
      name: "artifacts",
      ok: false,
      detail: "leak: steps/rollback.log:migrator-password-new, steps/smoke.log:token",
    });
    for (const file of ["smoke.log", "rollback.log"]) {
      const text = readFileSync(path.join(steps(), file), "utf8");
      const lines = text.split("\n").filter((l) => l !== "");
      expect(lines, file).toHaveLength(1);
      expect(lines[0], file).toMatch(/^withheld: 1 hit\(s\):/);
      for (const value of [CANARIES.token, NEW, Buffer.from(NEW).toString("base64")]) {
        expect(text, file).not.toContain(value);
      }
    }
    const report = readFileSync(path.join(workDir, "artifacts", "scan-report.json"), "utf8");
    const parsed = JSON.parse(report) as { final: { source: string; name: string }[] };
    expect(parsed.final.map((h) => `${h.source}:${h.name}`).sort()).toEqual([
      "steps/rollback.log:migrator-password-new",
      "steps/smoke.log:token",
    ]);
    for (const value of [CANARIES.token, NEW, OLD]) expect(report).not.toContain(value);
    const artifactCalls = calls.filter((c) => c.o.step === "artifacts");
    expect(artifactCalls.length).toBeGreaterThan(0);
    for (const c of artifactCalls) {
      expect(c.o.sensitiveStdout, [c.cmd, ...c.args].join(" ")).toBe(true);
    }
    expect(cleanups).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("TP-16.26: clean step logs: artifacts ok and the files unchanged", async () => {
    const { result } = await run(false);

    expect(result.steps.find((s) => s.name === "artifacts")).toEqual({
      name: "artifacts",
      ok: true,
      detail: "",
    });
    expect(readFileSync(path.join(steps(), "smoke.log"), "utf8")).toBe(
      "### pnpm (step smoke)\nok\n",
    );
    expect(readFileSync(path.join(steps(), "rollback.log"), "utf8")).toBe(
      "### docker (step rollback)\nclean\n",
    );
  });
});
