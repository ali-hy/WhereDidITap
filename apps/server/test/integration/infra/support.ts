// Helpers for the S-15 image tests (test-architect): build the laptop images from the repository,
// run docker / docker compose, and lay out a throwaway BUDMON_HOME as F-178 and F-191 would.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SERVER_DIR } from "../../support/platform.js";

export const ROOT = path.resolve(SERVER_DIR, "../..");
export const LOCAL = path.join(ROOT, "infra/local");
export const TEST_TAG = "tp15";

/**
 * A-391: the integration parts of TP-15.3, TP-15.13, TP-15.22 and TP-15.28 run in the infra-int CI
 * job (root script `test:infra`, infra/local/test/run-integration.sh, which sets this), with real
 * sudo, Docker and time to build the images; elsewhere they skip.
 */
export const INFRA_INT = process.env["BUDMON_INFRA_INT"] === "1";

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function sh(
  cmd: string,
  args: readonly string[],
  opts: { env?: Record<string, string | undefined>; input?: string; timeoutMs?: number } = {},
): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...opts.env }))
    if (typeof v === "string") env[k] = v;
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env,
    input: opts.input,
    timeout: opts.timeoutMs ?? 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Builds budmon/<name>:tp15 once per process, as F-178 phase B does (A-393): images/server and
 * images/web from the repository root with `-f images/<name>/Dockerfile`; images/postgres from its
 * own directory, with the named context `sql` for the cluster-bootstrap script.
 */
const built = new Set<string>();
export function buildImage(name: "postgres" | "server" | "web"): string {
  const tag = `budmon/${name}:${TEST_TAG}`;
  if (built.has(name)) return tag;
  const args =
    name === "postgres"
      ? [
          "build",
          "-q",
          "--build-context",
          `sql=${path.join(ROOT, "apps/server/src/platform/db/sql")}`,
          "-t",
          tag,
          path.join(ROOT, "images/postgres"),
        ]
      : ["build", "-q", "-f", path.join(ROOT, `images/${name}/Dockerfile`), "-t", tag, ROOT];
  const r = sh("docker", args, { timeoutMs: 1_200_000 });
  if (r.status !== 0) throw new Error(`docker build ${name} failed:\n${r.stdout}${r.stderr}`);
  built.add(name);
  return tag;
}

/** A BUDMON_HOME with pg/ (empty), maintenance/, a site.env and Postgres's secret files. */
export function laptopHome(secrets: Record<string, string>): string {
  const home = mkdtempSync(path.join(tmpdir(), "budmon-tp15-"));
  const pgSecrets = path.join(home, "secrets/main/postgres");
  mkdirSync(pgSecrets, { recursive: true });
  for (const [k, v] of Object.entries(secrets))
    writeFileSync(path.join(pgSecrets, k), v, { mode: 0o400 });
  mkdirSync(path.join(home, "pg"), { mode: 0o700 });
  mkdirSync(path.join(home, "maintenance"));
  writeFileSync(path.join(home, "site.env"), "PUBLIC_ORIGIN=https://l.t.ts.net\n", { mode: 0o600 });
  chmodSync(home, 0o755);
  return home;
}

/** A self-signed certificate and key for db.budmon.internal (openssl). */
export function tlsPair(dir: string): { cert: string; key: string } {
  const key = path.join(dir, "tls.key");
  const cert = path.join(dir, "tls.crt");
  const r = sh("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=db.budmon.internal",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  return { cert, key };
}

/** `docker compose` on the laptop's main file for project `project`, as F-178 runs it. */
export function compose(
  project: string,
  home: string,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): Run {
  return sh(
    "docker",
    [
      "compose",
      "--project-directory",
      LOCAL,
      "-p",
      project,
      "-f",
      path.join(LOCAL, "compose.main.yaml"),
      "--env-file",
      path.join(LOCAL, "local.env"),
      ...args,
    ],
    { env: { BUDMON_HOME: home, BUDMON_TAG: TEST_TAG, ...env } },
  );
}
