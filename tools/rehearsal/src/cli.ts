// F-195's CLI: `pnpm --filter @budmon/tools-rehearsal rehearse --previous <tag|none> --version <v>
// [--doctor <name>]`. It runs the rehearsal with the real child processes against the images tagged
// `rehearsal` (and the previous release's, tagged with its name), prints one line per record and
// exits 0 only when every record is ok. The work directory (artifacts in <workDir>/artifacts) is
// printed first. With --doctor (A-468, test only) it exits 0 only when the expected step failed
// first and cleanup succeeded.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  doctorVerdict,
  runRehearsal,
  STEP_ORDER,
  type Exec,
  type RehearsalDoctor,
  type StepName,
} from "./run.js";

const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$/;
const DOCTOR_NAME = /^[a-z0-9-]+$/;

function usage(): never {
  process.stderr.write(
    "usage: rehearse --previous <tag|none> --version <vX.Y.Z[-hotfix.N]> [--doctor <name>]\n",
  );
  process.exit(64);
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

const exec: Exec = (cmd, args, o) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: ["pipe", "pipe", "inherit"],
      ...(o.timeoutMs === undefined ? {} : { timeout: o.timeoutMs }),
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", () => {
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout });
    });
    child.stdin.end(o.input);
  });

/** A-452, A-468: --previous and --version once each, --doctor at most once, in any order. */
function parseArgs(argv: readonly string[]): {
  previous: string;
  version: string;
  doctor: string | undefined;
} {
  if (argv.length % 2 !== 0) usage();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    if (!["--previous", "--version", "--doctor"].includes(flag) || values.has(flag)) usage();
    values.set(flag, argv[i + 1] ?? "");
  }
  const previous = values.get("--previous");
  const version = values.get("--version");
  const doctor = values.get("--doctor");
  if (previous === undefined || version === undefined) usage();
  if ((previous !== "none" && !TAG.test(previous)) || !TAG.test(version)) usage();
  if (doctor !== undefined && !DOCTOR_NAME.test(doctor)) usage();
  return { previous, version, doctor };
}

/** A-468: the doctored overlay and its expected step, resolved before anything runs. */
function resolveDoctor(repoRoot: string, name: string): RehearsalDoctor {
  const dir = path.join(repoRoot, "tools/rehearsal/test/doctored");
  const found = (["main", "capture"] as const).filter((p) =>
    existsSync(path.join(dir, `${name}.${p}.yaml`)),
  );
  if (found.length === 0) refuse(`doctored overlay not found: ${name}`);
  if (found.length > 1) refuse(`doctored overlay ambiguous: ${name}`);
  const project = found[0] ?? "main";
  let expectations: unknown;
  try {
    expectations = JSON.parse(readFileSync(path.join(dir, "expectations.json"), "utf8"));
  } catch {
    expectations = undefined;
  }
  const expectStep =
    typeof expectations === "object" && expectations !== null
      ? (expectations as Record<string, unknown>)[name]
      : undefined;
  if (typeof expectStep !== "string" || !STEP_ORDER.includes(expectStep as StepName)) {
    refuse(`doctored expectation missing: ${name}`);
  }
  return {
    name,
    project,
    file: path.join(dir, `${name}.${project}.yaml`),
    expectStep: expectStep as StepName,
  };
}

const { previous, version, doctor: doctorName } = parseArgs(process.argv.slice(2));

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const doctor = doctorName === undefined ? null : resolveDoctor(repoRoot, doctorName);
const workDir = mkdtempSync(path.join(tmpdir(), "budmon-rehearsal-"));
process.stdout.write(`work dir: ${workDir}\n`);

const result = await runRehearsal(
  {
    previousTag: previous === "none" ? null : previous,
    version,
    images: {
      server: "budmon/server:rehearsal",
      web: "budmon/web:rehearsal",
      postgres: "budmon/postgres:rehearsal",
    },
    workDir,
    repoRoot,
    doctor,
  },
  { exec },
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
