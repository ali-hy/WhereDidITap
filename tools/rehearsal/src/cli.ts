// F-195's CLI: `pnpm --filter @budmon/tools-rehearsal rehearse --previous <tag|none> --version <v>
// [--doctor <name>] [--i-know-this-is-not-my-laptop]`. Order (A-478, A-479): parse, host check,
// repository root, doctored overlay, laptop-stack check, work directory, run; a refusal exits 2
// before any docker, sudo or sysctl call and before a work directory exists. Every child's output
// goes to <workDir>/artifacts/steps (A-476), so the job log shows only these lines. With --doctor
// (A-468, test only) the exit code is doctorVerdict's.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, resolveDoctor, USAGE } from "./args.js";
import { createLoggingExec } from "./exec.js";
import { checkNoLaptopStack, checkRehearsalHost, type GuardResult } from "./guard.js";
import { doctorVerdict, runRehearsal } from "./run.js";

function exit(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function refuseUnless(result: GuardResult): void {
  if (!result.ok) exit(2, `refusing to run: ${result.reason}`);
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) exit(64, USAGE);
const args = parsed.args;

refuseUnless(
  checkRehearsalHost({
    env: process.env,
    homeDir: homedir(),
    confirmNotLaptop: args.confirmNotLaptop,
    exists: existsSync,
  }),
);

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

let doctor = null;
if (args.doctor !== null) {
  const resolved = resolveDoctor(repoRoot, args.doctor);
  if (!resolved.ok) exit(64, resolved.message);
  doctor = resolved.doctor;
}

// The laptop check reads docker's stdout only; its stderr stays out of the job log.
refuseUnless(
  await checkNoLaptopStack((cmd, argv) => {
    const r = spawnSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return Promise.resolve({ code: r.status ?? 127, stdout: r.stdout });
  }),
);

const workDir = mkdtempSync(path.join(tmpdir(), "budmon-rehearsal-"));
const stepLogs = path.join(workDir, "artifacts", "steps");
process.stdout.write(`work dir: ${workDir}\nstep logs: ${stepLogs}\n`);

const result = await runRehearsal(
  {
    previousTag: args.previousTag,
    version: args.version,
    images: {
      server: "budmon/server:rehearsal",
      web: "budmon/web:rehearsal",
      postgres: "budmon/postgres:rehearsal",
    },
    workDir,
    repoRoot,
    doctor,
  },
  { exec: createLoggingExec(stepLogs) },
);
for (const step of result.steps) {
  process.stdout.write(
    `${step.ok ? "ok  " : "FAIL"} ${step.name}${step.detail === "" ? "" : `: ${step.detail}`}\n`,
  );
}
if (doctor === null) {
  process.exitCode = result.ok ? 0 : 1;
} else {
  // A-468: a doctored run passes when the expected step failed first, never because it was ok.
  const verdict = doctorVerdict(result.steps, doctor.expectStep);
  process.stdout.write(`${verdict.message}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
}
