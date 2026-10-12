// ci.yml's `changes` job (A-424): one output per consumer, one `run` line per output, each
// `if grep -qE '^(<p1>|<p2>|…)' "$RUNNER_TEMP/changed.txt"; then echo "<name>=true" >> …`.
// Tests read only their own output's line (TP-0.32, TP-15.35).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface ChangesStep {
  id?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
}
export interface ChangesJob {
  needs?: unknown;
  if?: unknown;
  outputs?: Record<string, unknown>;
  steps?: ChangesStep[];
}

export function ciJobs(root: string): Record<string, ChangesJob> {
  return (
    (
      parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as {
        jobs?: Record<string, ChangesJob>;
      }
    ).jobs ?? {}
  );
}

/** The `changes` job's run text (all steps). */
export function changesRun(root: string): string {
  return (ciJobs(root)["changes"]?.steps ?? [])
    .map((s) => (typeof s.run === "string" ? s.run : ""))
    .join("\n");
}

/**
 * The path prefixes on the one run line that sets `<name>=true`, with `\` removed; null when
 * there isn't exactly one such line with a `grep -qE '^(…)'` group.
 */
export function outputAlternatives(root: string, name: string): string[] | null {
  const lines = changesRun(root)
    .split("\n")
    .filter((l) => l.includes(`echo "${name}=true"`));
  if (lines.length !== 1) return null;
  const group = /grep -qE '\^\(([^)]*)\)'/.exec(lines[0] ?? "")?.[1];
  if (group === undefined) return null;
  return group.split("|").map((p) => p.replace(/\\/g, ""));
}
