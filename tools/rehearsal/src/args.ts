// A-479: the rehearsal CLI's arguments, side-effect free (importing this runs nothing and never
// touches `process`), so tests can check parsed values without spawning a run.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { STEP_ORDER, type RehearsalDoctor, type StepName } from "./run.js";

export const USAGE =
  "usage: rehearse --previous <tag|none> --version <vX.Y.Z[-hotfix.N]> [--doctor <name>] [--i-know-this-is-not-my-laptop]";

const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$/;
const DOCTOR_NAME = /^[a-z0-9-]+$/;
const CONFIRM = "--i-know-this-is-not-my-laptop";

export interface ParsedArgs {
  previousTag: string | null;
  version: string;
  doctor: string | null;
  confirmNotLaptop: boolean;
}

/** Left to right: --previous, --version and --doctor take the next token; the confirmation is bare. */
export function parseArgs(argv: readonly string[]): { ok: true; args: ParsedArgs } | { ok: false } {
  const values = new Map<string, string>();
  let confirm = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === CONFIRM) {
      if (confirm) return { ok: false };
      confirm = true;
      continue;
    }
    if (token !== "--previous" && token !== "--version" && token !== "--doctor")
      return { ok: false };
    if (values.has(token) || i + 1 >= argv.length) return { ok: false };
    values.set(token, argv[i + 1] ?? "");
    i += 1;
  }
  const previous = values.get("--previous");
  const version = values.get("--version");
  const doctor = values.get("--doctor");
  if (previous === undefined || version === undefined) return { ok: false };
  if ((previous !== "none" && !TAG.test(previous)) || !TAG.test(version)) return { ok: false };
  if (doctor !== undefined && !DOCTOR_NAME.test(doctor)) return { ok: false };
  return {
    ok: true,
    args: {
      previousTag: previous === "none" ? null : previous,
      version,
      doctor: doctor ?? null,
      confirmNotLaptop: confirm,
    },
  };
}

const defaultFs = {
  exists: (p: string) => existsSync(p),
  readFile: (p: string) => readFileSync(p, "utf8"),
};

/** A-468: the doctored overlay and its expected step, or the message to print (exit 64). */
export function resolveDoctor(
  repoRoot: string,
  name: string,
  fs: { exists(p: string): boolean; readFile(p: string): string } = defaultFs,
): { ok: true; doctor: RehearsalDoctor } | { ok: false; message: string } {
  const dir = path.join(repoRoot, "tools/rehearsal/test/doctored");
  const found = (["main", "capture"] as const).filter((p) =>
    fs.exists(path.join(dir, `${name}.${p}.yaml`)),
  );
  if (found.length === 0) return { ok: false, message: `doctored overlay not found: ${name}` };
  if (found.length > 1) return { ok: false, message: `doctored overlay ambiguous: ${name}` };
  const project = found[0] ?? "main";
  let expectations: unknown;
  try {
    expectations = JSON.parse(fs.readFile(path.join(dir, "expectations.json")));
  } catch {
    expectations = undefined;
  }
  const expectStep =
    typeof expectations === "object" && expectations !== null
      ? (expectations as Record<string, unknown>)[name]
      : undefined;
  if (typeof expectStep !== "string" || !STEP_ORDER.includes(expectStep as StepName)) {
    return { ok: false, message: `doctored expectation missing: ${name}` };
  }
  return {
    ok: true,
    doctor: {
      name,
      project,
      file: path.join(dir, `${name}.${project}.yaml`),
      expectStep: expectStep as StepName,
    },
  };
}
