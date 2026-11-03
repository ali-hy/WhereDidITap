// A-478: the rehearsal refuses to run where it could touch an owner's laptop stack. This is the
// only file under tools/rehearsal/src that names the laptop's projects and network.
import path from "node:path";
import type { Exec } from "./run.js";

export const LAPTOP_PROJECTS = ["budmon-main", "budmon-capture"] as const;
export const LAPTOP_CAPTURE_DB_NETWORK = "budmon_capture_db";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Side-effect free: CI (or an explicit confirmation), and never on a host with a Budmon install.
 * The install checks can't be overridden.
 */
export function checkRehearsalHost(f: {
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  confirmNotLaptop: boolean;
  exists(path: string): boolean;
}): GuardResult {
  if (f.env["CI"] !== "true" && !f.confirmNotLaptop) {
    return { ok: false, reason: "not CI: set CI=true or pass --i-know-this-is-not-my-laptop" };
  }
  if (f.exists(path.join(f.homeDir, ".budmon", "state"))) {
    return { ok: false, reason: "a Budmon install exists: ~/.budmon/state" };
  }
  const budmonHome = f.env["BUDMON_HOME"];
  if (budmonHome !== undefined && budmonHome !== "" && f.exists(path.join(budmonHome, "state"))) {
    return { ok: false, reason: "a Budmon install exists: $BUDMON_HOME/state" };
  }
  return { ok: true };
}

/** No container of the laptop's projects and no laptop capture network may exist (tag `guard`). */
export async function checkNoLaptopStack(exec: Exec): Promise<GuardResult> {
  for (const name of LAPTOP_PROJECTS) {
    const r = await exec(
      "docker",
      ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${name}`],
      { step: "guard" },
    );
    if (r.code !== 0) return { ok: false, reason: "docker unavailable" };
    if (r.stdout.trim() !== "") return { ok: false, reason: `laptop stack present: ${name}` };
  }
  const net = await exec(
    "docker",
    ["network", "ls", "-q", "--filter", `name=^${LAPTOP_CAPTURE_DB_NETWORK}$`],
    { step: "guard" },
  );
  if (net.code !== 0) return { ok: false, reason: "docker unavailable" };
  if (net.stdout.trim() !== "") {
    return { ok: false, reason: `laptop stack present: ${LAPTOP_CAPTURE_DB_NETWORK}` };
  }
  return { ok: true };
}
