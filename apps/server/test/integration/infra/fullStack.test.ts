// The laptop stack's full-stack cases (F-175, F-178), run by the infra-int CI job (A-391, `pnpm
// test:infra`) with real sudo and Docker; skipped elsewhere.
//   - TP-15.3: pg_hba.conf, probed from throwaway clients (the Postgres image's psql) on the right
//     network and address. Only `postgres` is up; the roles get throwaway passwords as budmon_admin,
//     so a rejected case fails at pg_hba.conf, never at the password.
//   - TP-15.28 (I): `budmon-local secret set` with real sudo after F-191; the ownership rows
//     (F-178's layout table) are applied here with sudo, as apply_secret_ownership would, since its
//     calling convention isn't specified.
//   - TP-15.34 (I): listen_addresses in the stack, and in the image started alone (A-418).
//   - TP-15.22 (I1, I2): a real install of a throwaway tag (a temporary origin whose default branch
//     is master), then restores of a seeded dump, a truncated dump and one failing half-way.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, pbkdf2Sync, randomBytes } from "node:crypto";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../../src/platform/security/headers.js";
import { generateBaseline, serverFixture } from "../../support/s14.js";
import {
  buildImage,
  compose,
  INFRA_INT,
  laptopHome,
  LOCAL,
  ROOT,
  sh,
  TEST_TAG,
  tlsPair,
} from "./support.js";

const PG_DATA_IP = "172.30.40.10";
const PG_CAPTURE_IP = "172.30.42.2";
const WORKER_CAPTURE_IP = "172.30.42.4";
const PW = { app: "app-pw-tp15-3", capture: "capture-pw-tp15-3", migrator: "migrator-pw-tp15-3" };
const HBA_REJECTED = /pg_hba\.conf rejects connection|no pg_hba\.conf entry/;

/** A SCRAM-SHA-256 verifier (RFC 7677), computed here so the test doesn't need budmonctl. */
function verifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const stored = createHash("sha256").update(clientKey).digest("base64");
  const server = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`;
}

describe.skipIf(!INFRA_INT)("TP-15.3: pg_hba.conf on the laptop (F-175)", () => {
  const PROJECT = `budmon-tp15-hba-${String(process.pid)}`;
  let home = "";
  let certs = "";
  let createdNetwork = false;

  const psqlAdmin = (sql: string, db = "postgres") =>
    compose(PROJECT, home, [
      "exec",
      "-T",
      "-u",
      "postgres",
      "postgres",
      "psql",
      "-U",
      "budmon_admin",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      sql,
    ]);

  /** psql from a throwaway container on `network` (optionally at `ip`), returning the result. */
  const probe = (opts: {
    network: string;
    ip?: string;
    host: string;
    user: string;
    password: string;
    db: string;
    sslmode: "disable" | "verify-full" | "prefer";
  }) =>
    sh("docker", [
      "run",
      "--rm",
      "--network",
      opts.network,
      ...(opts.ip === undefined ? [] : ["--ip", opts.ip]),
      "--add-host",
      `db.budmon.internal:${PG_CAPTURE_IP}`,
      "-e",
      `PGPASSWORD=${opts.password}`,
      "-v",
      `${certs}:/certs:ro`,
      "--entrypoint",
      "psql",
      `budmon/postgres:${TEST_TAG}`,
      `host=${opts.host} port=5432 user=${opts.user} dbname=${opts.db} sslmode=${opts.sslmode} sslrootcert=/certs/tls.crt connect_timeout=10`,
      "-tAc",
      "SELECT 1",
    ]);

  beforeAll(async () => {
    buildImage("postgres");
    certs = mkdtempSync(path.join(tmpdir(), "budmon-tp15-3-tls-"));
    const { cert, key } = tlsPair(certs);
    sh("chmod", ["0755", certs]);
    sh("chmod", ["0644", cert]);
    home = laptopHome({
      ADMIN_PASSWORD: "admin-pw-tp15-3",
      MIGRATOR_VERIFIER: verifier(PW.migrator),
      TLS_CERT: readFileSync(cert, "utf8"),
      TLS_KEY: readFileSync(key, "utf8"),
    });
    for (const p of [path.join(home, "pg"), path.join(home, "secrets/main/postgres")]) {
      const r = sh("sudo", ["chown", "-R", "999:999", p]);
      if (r.status !== 0) throw new Error(`chown 999 ${p}: ${r.stderr}`);
    }
    if (sh("docker", ["network", "inspect", "budmon_capture_db"]).status !== 0) {
      const r = sh("docker", [
        "network",
        "create",
        "--internal",
        "--subnet",
        "172.30.42.0/29",
        "budmon_capture_db",
      ]);
      if (r.status !== 0) throw new Error(`network create: ${r.stderr}`);
      createdNetwork = true;
    }
    const up = compose(PROJECT, home, ["up", "-d", "--no-deps", "postgres"], {
      BUDMON_FIRST_SETUP: "1",
    });
    if (up.status !== 0) throw new Error(`compose up postgres: ${up.stderr}`);
    // First setup runs the upstream entrypoint's temporary server (socket only), stops it, then
    // starts the real one, so one successful SELECT 1 can still be followed by a refused socket.
    // Ready means: the init process has completed (its log line) and 3 SELECT 1s in a row pass.
    const logs = () => {
      const r = compose(PROJECT, home, ["logs", "--no-color", "postgres"]);
      return `${r.stdout}${r.stderr}`;
    };
    const deadline = Date.now() + 150_000;
    let inARow = 0;
    while (inARow < 3) {
      if (Date.now() > deadline) {
        throw new Error(
          `postgres never became ready:\n${logs().split("\n").slice(-40).join("\n")}`,
        );
      }
      const initDone = logs().includes("PostgreSQL init process complete");
      inARow = initDone && psqlAdmin("SELECT 1").status === 0 ? inARow + 1 : 0;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    for (const sql of [
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'budmon_app') THEN CREATE ROLE budmon_app LOGIN; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'budmon_capture') THEN CREATE ROLE budmon_capture LOGIN; END IF; END $$`,
      `ALTER ROLE budmon_app PASSWORD '${verifier(PW.app)}'`,
      `ALTER ROLE budmon_capture PASSWORD '${verifier(PW.capture)}'`,
      `GRANT CONNECT ON DATABASE budmon TO budmon_app, budmon_capture`,
      `CREATE DATABASE budmon_restore OWNER budmon_migrator`,
      `GRANT CONNECT ON DATABASE budmon_restore TO budmon_app`,
    ]) {
      const r = psqlAdmin(sql);
      if (r.status !== 0) throw new Error(`setup SQL failed: ${sql}\n${r.stderr}`);
    }
  }, 1_800_000);

  afterAll(() => {
    if (home !== "") compose(PROJECT, home, ["down", "-v", "--remove-orphans"]);
    if (createdNetwork) sh("docker", ["network", "rm", "budmon_capture_db"]);
    for (const dir of [home, certs]) if (dir !== "") sh("sudo", ["rm", "-rf", dir]);
  });

  const DATA = () => `${PROJECT}_data`;

  it("TP-15.3: budmon_capture from worker-capture over verify-full to db.budmon.internal: ok", () => {
    const r = probe({
      network: "budmon_capture_db",
      ip: WORKER_CAPTURE_IP,
      host: "db.budmon.internal",
      user: "budmon_capture",
      password: PW.capture,
      db: "budmon",
      sslmode: "verify-full",
    });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("1");
  });

  it("TP-15.3: budmon_capture from worker-capture with sslmode=disable: rejected", () => {
    const r = probe({
      network: "budmon_capture_db",
      ip: WORKER_CAPTURE_IP,
      host: "db.budmon.internal",
      user: "budmon_capture",
      password: PW.capture,
      db: "budmon",
      sslmode: "disable",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(HBA_REJECTED);
  });

  it("TP-15.3: budmon_app from worker-capture's address: rejected", () => {
    const r = probe({
      network: "budmon_capture_db",
      ip: WORKER_CAPTURE_IP,
      host: "db.budmon.internal",
      user: "budmon_app",
      password: PW.app,
      db: "budmon",
      sslmode: "verify-full",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(HBA_REJECTED);
  });

  it("TP-15.3: budmon_admin over TCP from the data network (api's): rejected", () => {
    const r = probe({
      network: DATA(),
      host: PG_DATA_IP,
      user: "budmon_admin",
      password: "admin-pw-tp15-3",
      db: "budmon",
      sslmode: "prefer",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(HBA_REJECTED);
  });

  it("TP-15.3: budmon_capture from api's data address: rejected", () => {
    const r = probe({
      network: DATA(),
      host: PG_DATA_IP,
      user: "budmon_capture",
      password: PW.capture,
      db: "budmon",
      sslmode: "prefer",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(HBA_REJECTED);
  });

  it("TP-15.3: budmon_migrator to budmon_restore from the data network: ok", () => {
    const r = probe({
      network: DATA(),
      host: PG_DATA_IP,
      user: "budmon_migrator",
      password: PW.migrator,
      db: "budmon_restore",
      sslmode: "prefer",
    });

    expect(r.status, r.stderr).toBe(0);
  });

  // A-418: the stack passes BUDMON_LISTEN_ADDRESSES = PG_DATA_IP,PG_CAPTURE_IP.
  it("TP-15.34 (I): SHOW listen_addresses over the socket in the stack is 172.30.40.10,172.30.42.2", () => {
    const r = psqlAdmin("SHOW listen_addresses");

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`${PG_DATA_IP},${PG_CAPTURE_IP}`);
  });

  // A-432: the image runs as postgres (999) with every capability dropped.
  // A-448: Health.Status is healthy within 120 s.
  it("TP-15.42 (I): postgres is healthy after first setup and runs with CapEff 0000000000000000", async () => {
    const id = compose(PROJECT, home, ["ps", "-q", "postgres"]).stdout.trim();
    const health = () =>
      sh("docker", [
        "inspect",
        "-f",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
        id,
      ]).stdout.trim();
    const deadline = Date.now() + 120_000;
    let state = health();
    while (state !== "healthy" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      state = health();
    }
    expect(state).toBe("healthy");
    const status = sh("docker", ["exec", id, "cat", "/proc/1/status"]);

    expect(status.stdout).toMatch(/^CapEff:\s+0000000000000000$/m);
  }, 150_000);

  it("TP-15.3: budmon_app to budmon_restore: rejected", () => {
    const r = probe({
      network: DATA(),
      host: PG_DATA_IP,
      user: "budmon_app",
      password: PW.app,
      db: "budmon_restore",
      sslmode: "prefer",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(HBA_REJECTED);
  });
});

// A-418: unset BUDMON_LISTEN_ADDRESSES means listen_addresses '' (socket only), failing closed.
describe.skipIf(!INFRA_INT)("TP-15.34 (I): the Postgres image started alone (F-170, A-418)", () => {
  const NAME = `budmon-tp15-34-${String(process.pid)}`;
  let home = "";

  beforeAll(async () => {
    buildImage("postgres");
    const scratch = mkdtempSync(path.join(tmpdir(), "budmon-tp15-34-tls-"));
    const { cert, key } = tlsPair(scratch);
    home = laptopHome({
      ADMIN_PASSWORD: "admin-pw-tp15-34",
      MIGRATOR_VERIFIER: verifier("migrator-pw-tp15-34"),
      TLS_CERT: readFileSync(cert, "utf8"),
      TLS_KEY: readFileSync(key, "utf8"),
    });
    sh("rm", ["-rf", scratch]);
    for (const p of [path.join(home, "pg"), path.join(home, "secrets/main/postgres")]) {
      const r = sh("sudo", ["chown", "-R", "999:999", p]);
      if (r.status !== 0) throw new Error(`chown 999 ${p}: ${r.stderr}`);
    }
    const conf = path.join(LOCAL, "postgres");
    const run = sh("docker", [
      "run",
      "-d",
      "--name",
      NAME,
      "-e",
      "BUDMON_FIRST_SETUP=1",
      "-v",
      `${path.join(home, "pg")}:/var/lib/postgresql/data`,
      "-v",
      `${path.join(home, "secrets/main/postgres")}:/run/secrets:ro`,
      "-v",
      `${path.join(conf, "postgresql.conf")}:/etc/budmon/postgresql.conf:ro`,
      "-v",
      `${path.join(conf, "pg_hba.conf")}:/etc/budmon/pg_hba.conf:ro`,
      "-v",
      `${path.join(conf, "pg_ident.conf")}:/etc/budmon/pg_ident.conf:ro`,
      `budmon/postgres:${TEST_TAG}`,
    ]);
    if (run.status !== 0) throw new Error(`docker run: ${run.stderr}`);
    for (let i = 0; i < 90; i += 1) {
      const ready = sh("docker", [
        "exec",
        "-u",
        "postgres",
        NAME,
        "pg_isready",
        "-U",
        "budmon_admin",
      ]);
      if (ready.status === 0) return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`postgres never became ready: ${sh("docker", ["logs", NAME]).stderr}`);
  }, 1_800_000);

  afterAll(() => {
    sh("docker", ["rm", "-f", NAME]);
    if (home !== "") sh("sudo", ["rm", "-rf", home]);
  });

  it("TP-15.34 (I): without BUDMON_LISTEN_ADDRESSES, SHOW listen_addresses is the empty string", () => {
    const r = sh("docker", [
      "exec",
      "-u",
      "postgres",
      NAME,
      "psql",
      "-U",
      "budmon_admin",
      "-tAc",
      "SHOW listen_addresses",
    ]);

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

/** F-178's layout table: each service directory's container UID. */
const OWNERS: readonly (readonly [string, number])[] = [
  ["main/api", 10001],
  ["main/worker-general", 10002],
  ["capture/worker-capture", 10003],
  ["main/migrate", 10004],
  ["main/postgres", 999],
];

describe.skipIf(!INFRA_INT)("TP-15.28 (I): secret set with real sudo (F-178)", () => {
  let home = "";

  beforeAll(() => {
    buildImage("server");
    home = mkdtempSync(path.join(tmpdir(), "budmon-tp15-28-"));
    const init = sh(path.join(ROOT, "infra/budmonctl/node_modules/.bin/tsx"), [
      path.join(ROOT, "infra/budmonctl/src/cli.ts"),
      "secrets",
      "init-local",
      "--home",
      home,
    ]);
    if (init.status !== 0) throw new Error(`init-local: ${init.stdout}${init.stderr}`);
    for (const [dir, uid] of OWNERS) {
      const p = path.join(home, "secrets", dir);
      for (const args of [
        ["chown", "-R", `${String(uid)}:${String(uid)}`, p],
        ["find", p, "-type", "f", "-exec", "chmod", "0400", "{}", "+"],
        ["chmod", "0500", p],
      ]) {
        const r = sh("sudo", args);
        if (r.status !== 0) throw new Error(`sudo ${args.join(" ")}: ${r.stderr}`);
      }
    }
  }, 1_800_000);

  afterAll(() => {
    if (home !== "") sh("sudo", ["rm", "-rf", home]);
  });

  it("TP-15.28 (I): printf v | secret set main/api/CURSOR_KEY: owner 10001, mode 0400; readable as 10001, denied as 10002", () => {
    const set = sh(path.join(LOCAL, "budmon-local"), ["secret", "set", "main/api/CURSOR_KEY"], {
      env: { BUDMON_HOME: home },
      input: "v",
    });
    expect(set.status, `${set.stdout}${set.stderr}`).toBe(0);
    expect(`${set.stdout}${set.stderr}`).not.toMatch(/(^|\s)v(\s|$)/);

    const file = path.join(home, "secrets/main/api/CURSOR_KEY");
    const stat = sh("sudo", ["stat", "-c", "%u %a", file]);
    expect(stat.stdout.trim()).toBe("10001 400");

    const dir = path.join(home, "secrets/main/api");
    const read = (user: string) =>
      sh("docker", [
        "run",
        "--rm",
        "--user",
        user,
        "-v",
        `${dir}:/s:ro`,
        "--entrypoint",
        "cat",
        `budmon/server:${TEST_TAG}`,
        "/s/CURSOR_KEY",
      ]);
    const owner = read("10001");
    expect(owner.status, owner.stderr).toBe(0);
    expect(owner.stdout).toBe("v");
    const other = read("10002");
    expect(other.status).not.toBe(0);
    expect(other.stderr).toMatch(/Permission denied/);
  }, 300_000);

  it("TP-15.28 (I) (A-487): secret set main/worker-general/SMTP_PASSWORD --empty after it held p: 0 bytes, owner 10002, mode 0400", () => {
    const rel = "main/worker-general/SMTP_PASSWORD";
    const first = sh(path.join(LOCAL, "budmon-local"), ["secret", "set", rel], {
      env: { BUDMON_HOME: home },
      input: "p",
    });
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    const file = path.join(home, "secrets", rel);
    expect(sh("sudo", ["stat", "-c", "%s", file]).stdout.trim()).toBe("1");

    const empty = sh(path.join(LOCAL, "budmon-local"), ["secret", "set", rel, "--empty"], {
      env: { BUDMON_HOME: home },
      input: "",
    });
    expect(empty.status, `${empty.stdout}${empty.stderr}`).toBe(0);
    expect(empty.stdout).toContain(`written ${rel} (empty: no SMTP authentication)`);

    expect(sh("sudo", ["stat", "-c", "%s %u %a", file]).stdout.trim()).toBe("0 10002 400");
  }, 300_000);
});

/** The PEM of a fresh RSA-3072 public key: CAPTURE_PUBLIC_KEY must be at least 3072 bits (F-10). */
function rsaPublicPem(): string {
  return generateKeyPairSync("rsa", { modulusLength: 3072 })
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
}

// TP-15.22 (I1, I2): a real install of a throwaway tag, then restores, with real sudo and Docker.
describe.skipIf(!INFRA_INT)("TP-15.22 (I): install and restore on a real runner (F-178)", () => {
  const TAG = "v0.0.1";
  let home = "";
  let work = "";
  let repoDir = "";
  let origin = "";
  /** The seeded database's per-table row counts, as "table=count,…". */
  let seeded = "";
  let firstDump = "";

  const env = () => ({ BUDMON_HOME: home, BUDMON_REPO: repoDir });
  const budmonLocal = (args: readonly string[], input?: string) =>
    sh(path.join(LOCAL, "budmon-local"), args, {
      env: env(),
      ...(input === undefined ? {} : { input }),
      timeoutMs: 1_500_000,
    });
  const container = (project: "main" | "capture", service: string) =>
    sh("docker", [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=budmon-${project}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
    ]).stdout.trim();
  const adminSql = (sql: string, db = "budmon") =>
    sh("docker", [
      "exec",
      "-u",
      "postgres",
      container("main", "postgres"),
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-At",
      "-U",
      "budmon_admin",
      "-d",
      db,
      "-c",
      sql,
    ]);
  const COUNTS = `SELECT coalesce(string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text), ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  const counts = () => {
    const r = adminSql(COUNTS);
    if (r.status !== 0) throw new Error(`counts: ${r.stderr}`);
    return r.stdout.trim();
  };
  /** Runs `command` with bash, so binary dumps go through redirections, not through strings. */
  const bash = (command: string) => sh("bash", ["-c", command], { timeoutMs: 600_000 });
  const dumpPath = (stamp: string) => path.join(home, "dumps", `${stamp}_${TAG}.dump`);
  const ready = async () => (await fetch("http://127.0.0.1:8080/health/ready")).status;
  /** The newest pre-restore dump restores cleanly into a scratch database. */
  const safetyDumpRestores = (scratch: string) => {
    const latest = bash(`ls -1t '${home}/dumps/'*_pre-restore.dump | head -n 1`).stdout.trim();
    expect(latest).not.toBe("");
    expect(adminSql(`CREATE DATABASE ${scratch}`, "postgres").status).toBe(0);
    const r = bash(
      `sudo cat '${latest}' | docker exec -i -u postgres ${container("main", "postgres")} pg_restore -U budmon_admin -d ${scratch} --exit-on-error`,
    );
    expect(r.status, r.stderr).toBe(0);
    adminSql(`DROP DATABASE ${scratch}`, "postgres");
  };

  const tail = (text: string, n: number) => text.trimEnd().split("\n").slice(-n);
  /** What a failed start leaves to read: each container's state, health and log tail, and the three readiness probes budmon-local runs (F-178). */
  const stackDiagnostics = () => {
    const out: string[] = ["---- stack diagnostics ----"];
    for (const project of ["budmon-main", "budmon-capture"]) {
      const ids = sh("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .stdout.split("\n")
        .filter((id) => id !== "");
      for (const id of ids) {
        out.push(
          sh("docker", [
            "inspect",
            "-f",
            "== {{.Name}} {{.State.Status}} restarts={{.RestartCount}} exit={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
            id,
          ]).stdout.trim(),
        );
        const logs = sh("docker", ["logs", "--tail", "40", id]);
        out.push(...tail(`${logs.stdout}${logs.stderr}`, 40).map((l) => `   ${l}`));
      }
    }
    for (const [project, service, args] of [
      ["main", "api", ["--ready"]],
      ["main", "worker-general", ["--heartbeat"]],
      ["capture", "worker-capture", ["--heartbeat"]],
    ] as const) {
      const id = container(project, service);
      const probe =
        id === ""
          ? { status: null, stdout: "", stderr: "no container" }
          : sh("docker", ["exec", id, "node", "dist/main/healthcheck.js", ...args]);
      out.push(
        `probe ${service} ${args.join(" ")}: exit ${String(probe.status)} ${`${probe.stdout}${probe.stderr}`.trim()}`,
      );
    }
    return out.join("\n");
  };

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), "budmon-tp15-22-"));
    home = path.join(work, "home");
    mkdirSync(home, { mode: 0o700 });
    // A throwaway origin whose default branch is master: this commit, then a release commit adding
    // the server's baseline migration (as a real first release has; before it, migrate builds no
    // tables, A-179), tagged TAG.
    origin = path.join(work, "origin.git");
    repoDir = path.join(work, "repo");
    const git = (args: readonly string[], cwd?: string) => {
      const r = sh("git", cwd === undefined ? args : ["-C", cwd, ...args]);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    git(["init", "-q", "--bare", "-b", "master", origin]);
    git(["config", "receive.shallowUpdate", "true"], origin);
    git(["push", "-q", origin, "HEAD:refs/heads/master"], ROOT);
    git(["clone", "-q", origin, repoDir]);
    const fixture = serverFixture(work);
    try {
      generateBaseline(fixture.dir, TAG);
      cpSync(fixture.drizzle, path.join(repoDir, "apps/server/drizzle"), { recursive: true });
    } finally {
      fixture.remove();
    }
    git(["add", "apps/server/drizzle"], repoDir);
    git(
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "commit",
        "-q",
        "-m",
        `release ${TAG}`,
      ],
      repoDir,
    );
    git(["push", "-q", "origin", "HEAD:refs/heads/master"], repoDir);
    git(["tag", TAG, "master"], origin);

    // First install: answers piped, then exit 20 listing the placeholders (A-385).
    const first = budmonLocal(["install", TAG], "laptop.tailnet.ts.net\n");
    if (first.status !== 20) throw new Error(`install 1: ${String(first.status)} ${first.stderr}`);
    const pub = rsaPublicPem();
    const values: Record<string, string> = {
      "main/api/S3_ACCESS_KEY_ID": "access-key-id",
      "main/api/S3_SECRET_ACCESS_KEY": "secret-access-key",
      "main/api/CAPTURE_PUBLIC_KEY": pub,
      "main/api/GOOGLE_SIGNIN_CLIENT_SECRET": "signin-secret",
      "main/worker-general/S3_ACCESS_KEY_ID": "access-key-id",
      "main/worker-general/S3_SECRET_ACCESS_KEY": "secret-access-key",
      "main/worker-general/FX_PRIMARY_APP_ID": "oxr-app-id",
      "main/worker-general/CAPTURE_PUBLIC_KEY": pub,
      "capture/worker-capture/GCP_CREDENTIALS": JSON.stringify({
        type: "service_account",
        project_id: "p",
      }),
      "capture/worker-capture/GOOGLE_OAUTH_CLIENT_SECRET": "oauth-secret",
      "capture/worker-capture/CAPTURE_PUBLIC_KEY": pub,
    };
    for (const [key, value] of Object.entries(values)) {
      const r = budmonLocal(["secret", "set", key], value);
      if (r.status !== 0) throw new Error(`secret set ${key}: ${r.stderr}`);
    }
    writeFileSync(
      path.join(home, "site.env"),
      [
        "PUBLIC_ORIGIN=https://laptop.tailnet.ts.net",
        "CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1",
        "GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com",
        "S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com",
        "S3_REGION=eu-central-003",
        "S3_BUCKET_EXPORTS=budmon-exports",
        "S3_BUCKET_ERASURE_LOG=budmon-erasure-log",
        "SENTRY_DSN=https://k@sentry.invalid/1",
        "GOOGLE_SIGNIN_CLIENT_ID=123-signin.apps.googleusercontent.com",
        "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS=",
        "GOOGLE_SIGNIN_CALLBACK_ORIGIN=http://localhost:8080",
        "GOOGLE_SIGNIN_APP_ORIGINS=https://laptop.tailnet.ts.net,http://localhost:8080",
        "SMTP_URL=smtp://mailpit:1025",
        "EMAIL_FROM=Budmon <no-reply@budmon.local>",
        "WEB_SENTRY_DSN=https://pub@sentry.invalid/2",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    // Second install: builds the three images from the tag and starts both projects.
    const second = budmonLocal(["install", TAG]);
    if (second.status !== 0) {
      const report = [
        `install 2 exited ${String(second.status)}; its last lines:`,
        ...tail(`${second.stdout}${second.stderr}`, 30),
        stackDiagnostics(),
      ].join("\n");
      // Printed as well as thrown: the runner's annotation truncates long messages.
      process.stderr.write(`${report}\n`);
      throw new Error(report);
    }
    for (let i = 0; i < 120 && (await ready().catch(() => 0)) !== 200; i += 1) {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }, 1_700_000);

  afterAll(() => {
    if (home === "") return;
    for (const project of ["budmon-main", "budmon-capture"]) {
      const ids = sh("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .stdout.split("\n")
        .filter((id) => id !== "");
      if (ids.length > 0) sh("docker", ["rm", "-f", "-v", ...ids]);
      const nets = sh("docker", [
        "network",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .stdout.split("\n")
        .filter((id) => id !== "");
      if (nets.length > 0) sh("docker", ["network", "rm", ...nets]);
    }
    sh("docker", ["network", "rm", "budmon_capture_db"]);
    sh("sudo", ["rm", "-rf", work]);
  });

  it("TP-15.22 (I1): every container is running, and healthy where it has a health check", async () => {
    const ids = ["budmon-main", "budmon-capture"].flatMap((project) =>
      sh("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`])
        .stdout.split("\n")
        .filter((id) => id !== ""),
    );
    expect(ids.length).toBeGreaterThan(0);
    const states = () =>
      ids.map((id) =>
        sh("docker", [
          "inspect",
          "-f",
          "{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
          id,
        ]).stdout.trim(),
      );
    // A health check's first run comes one interval after the start, so "starting" is waited out.
    let current = states();
    for (let i = 0; i < 90 && current.some((s) => s.endsWith(" starting")); i += 1) {
      await new Promise((r) => setTimeout(r, 1_000));
      current = states();
    }
    for (const state of current) expect(state).toMatch(/ running (healthy|none)$/);
  }, 120_000);

  // A-502 (6): on the installed stack, each security header appears once: the API's on its own
  // responses, Caddy's on the SPA.
  it("TP-15.52 (b): /api/v1/meta/client-config carries F-61's four headers once each; / carries Caddy's", async () => {
    const security = [
      "strict-transport-security",
      "content-security-policy",
      "referrer-policy",
      "x-content-type-options",
    ] as const;
    const raw = (urlPath: string) =>
      new Promise<string[]>((resolve, reject) => {
        const req = httpGet({ host: "127.0.0.1", port: 8080, path: urlPath }, (res) => {
          res.resume();
          res.on("end", () => {
            resolve(res.rawHeaders);
          });
        });
        req.on("error", reject);
      });
    const values = (headers: readonly string[], name: string) => {
      const out: string[] = [];
      for (let i = 0; i + 1 < headers.length; i += 2) {
        if ((headers[i] ?? "").toLowerCase() === name) out.push(headers[i + 1] ?? "");
      }
      return out;
    };

    const api = await raw("/api/v1/meta/client-config");
    for (const name of security) {
      expect(values(api, name), name).toEqual([SECURITY_HEADERS[name]]);
    }
    const spa = await raw("/");
    for (const name of security) expect(values(spa, name), name).toHaveLength(1);
    expect(values(spa, "strict-transport-security")).toEqual([
      "max-age=31536000; includeSubDomains",
    ]);
    expect(values(spa, "referrer-policy")).toEqual(["no-referrer"]);
    expect(values(spa, "x-content-type-options")).toEqual(["nosniff"]);
    // Review N-3: F-175's SPA policy exactly, as caddy.test.ts checks it.
    expect(values(spa, "content-security-policy")).toEqual([
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.de.sentry.io https://*.ingest.sentry.io; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ]);
  }, 60_000);

  // A-505: Docker hands dynamic addresses only from each network's ip_range, so no container can
  // take a static address that another container hasn't claimed yet.
  it("TP-15.56 (I): edge and data use local.env's subnet and ip_range; caddy and postgres hold their static addresses; the others are inside the ranges", () => {
    const localEnv = Object.fromEntries(
      readFileSync(path.join(home, "releases", TAG, "local.env"), "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    ) as Record<string, string | undefined>;
    const inspect = sh("docker", ["network", "inspect", "budmon-main_edge", "budmon-main_data"]);
    expect(inspect.status, inspect.stderr).toBe(0);
    const networks = JSON.parse(inspect.stdout) as {
      Name: string;
      IPAM: { Config: { Subnet?: string; IPRange?: string }[] };
    }[];
    const config = (name: string) => networks.find((n) => n.Name === name)?.IPAM.Config ?? [];
    for (const [name, subnet, range] of [
      ["budmon-main_edge", "EDGE_SUBNET", "EDGE_IP_RANGE"],
      ["budmon-main_data", "DATA_SUBNET", "DATA_IP_RANGE"],
    ] as const) {
      const entries = config(name);
      expect(entries, name).toHaveLength(1);
      expect(entries[0]?.Subnet, name).toBe(localEnv[subnet]);
      expect(entries[0]?.IPRange, name).toBe(localEnv[range]);
    }

    const address = (service: string, network: string) => {
      const r = sh("docker", [
        "inspect",
        "-f",
        `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
        container("main", service),
      ]);
      expect(r.status, `${service}: ${r.stderr}`).toBe(0);
      return r.stdout.trim();
    };
    const toNumber = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
    const inRange = (ip: string, cidrText: string | undefined) => {
      const [base, bits] = (cidrText ?? "").split("/");
      const size = 2 ** (32 - Number(bits));
      const start = toNumber(base ?? "");
      return toNumber(ip) >= start && toNumber(ip) < start + size;
    };

    expect(address("caddy", "budmon-main_edge")).toBe("172.30.41.2");
    expect(address("postgres", "budmon-main_data")).toBe("172.30.40.10");
    const dynamic: [string, string, string][] = [
      ["api", "budmon-main_edge", "EDGE_IP_RANGE"],
      ["api", "budmon-main_data", "DATA_IP_RANGE"],
      ["worker-general", "budmon-main_data", "DATA_IP_RANGE"],
      ["mailpit", "budmon-main_data", "DATA_IP_RANGE"],
    ];
    for (const [service, network, range] of dynamic) {
      const ip = address(service, network);
      expect(inRange(ip, localEnv[range]), `${service} on ${network}: ${ip}`).toBe(true);
    }
  });

  it("TP-15.22 (I1): Postgres starts with its TLS key owned by 999", () => {
    const owner = sh("sudo", [
      "stat",
      "-c",
      "%u",
      path.join(home, "secrets/main/postgres/TLS_KEY"),
    ]);

    expect(owner.stdout.trim()).toBe("999");
  });

  it("TP-15.22 (I1): restore of a dump of a seeded database: row counts equal the seeded ones; CONNECT revoked from PUBLIC and held by every login role; restore:verify ran", () => {
    const seed = adminSql(
      "INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at) SELECT 'tp15-22-' || g, now(), g, now() + interval '7 days' FROM generate_series(1, 25) g",
    );
    expect(seed.status, seed.stderr).toBe(0);
    seeded = counts();
    expect(seeded).toContain("rate_limit_counters=");
    firstDump = dumpPath("20261012T120000Z");
    const dump = bash(
      `docker exec -u postgres ${container("main", "postgres")} pg_dump -Fc -U budmon_admin budmon > '${firstDump}' && chmod 0600 '${firstDump}'`,
    );
    expect(dump.status, dump.stderr).toBe(0);
    // Changed after the dump, so the restore has something to undo.
    adminSql("DELETE FROM rate_limit_counters WHERE bucket_key LIKE 'tp15-22-%'");

    // A recording docker ahead of the real one, for A-438's check of the verify call.
    const shim = path.join(work, "shim");
    mkdirSync(shim, { recursive: true });
    const realDocker = sh("bash", ["-c", "command -v docker"]).stdout.trim();
    writeFileSync(
      path.join(shim, "docker"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${path.join(work, "docker-calls")}'\nexec '${realDocker}' "$@"\n`,
      { mode: 0o755 },
    );
    const r = sh(path.join(LOCAL, "budmon-local"), ["restore", firstDump], {
      env: { ...env(), PATH: `${shim}:${process.env["PATH"] ?? ""}` },
      timeoutMs: 1_500_000,
    });

    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(counts()).toBe(seeded);
    // A-469: the kept database has exactly the printed, upper-case T/Z name in pg_database.
    const kept = /kept as (budmon_old_[0-9]{8}T[0-9]{6}Z)\b/.exec(`${r.stdout}${r.stderr}`)?.[1];
    expect(kept, `${r.stdout}${r.stderr}`).toBeDefined();
    expect(
      adminSql(
        `SELECT count(*) FROM pg_database WHERE datname = '${kept ?? ""}'`,
        "postgres",
      ).stdout.trim(),
      adminSql("SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database", "postgres")
        .stdout,
    ).toBe("1");
    expect(
      adminSql("SELECT has_database_privilege('public', 'budmon', 'CONNECT')").stdout.trim(),
    ).toBe("f");
    expect(
      adminSql(
        "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolcanlogin AND NOT has_database_privilege(rolname, 'budmon', 'CONNECT')",
      ).stdout.trim(),
    ).toBe("");
    // A-438: restore:verify ran as budmon_migrator, in four checks.
    // 1. It printed an ok report.
    expect(`${r.stdout}${r.stderr}`).toMatch(/"ok":\s*true/);
    // 2. The recorded call runs it in the migrate service against budmon_restore.
    expect(readFileSync(path.join(work, "docker-calls"), "utf8")).toMatch(
      /compose .*--profile tools run --rm -e DB_NAME=budmon_restore migrate node dist\/main\/cli\.js restore:verify/,
    );
    // 3. Compose resolves that service's DB_USER to budmon_migrator.
    const compose = (args: string) =>
      bash(
        `BUDMON_HOME='${home}' BUDMON_TAG=${TAG} docker compose -p budmon-main --project-directory '${home}/releases/${TAG}' -f '${home}/releases/${TAG}/compose.main.yaml' --env-file '${home}/releases/${TAG}/local.env' ${args}`,
      );
    expect(
      compose(
        "--profile tools config --format json | jq -r '.services.migrate.environment.DB_USER'",
      ).stdout.trim(),
    ).toBe("budmon_migrator");
    // 4. The same command in api (DB_USER budmon_app) fails: pg_hba admits only budmon_migrator to
    // budmon_restore.
    const asApp = compose(
      "run --rm --no-deps -e DB_NAME=budmon_restore api node dist/main/cli.js restore:verify",
    );
    expect(asApp.status).not.toBe(0);
    expect(`${asApp.stdout}${asApp.stderr}`).not.toMatch(/"ok":\s*true/);
  }, 900_000);

  it("TP-15.22 (I2): a truncated copy of a valid dump fails with 14 or 29 (A-447); budmon keeps the seeded rows, /health/ready is 200, the safety dump restores", async () => {
    const truncated = dumpPath("20261012T120100Z");
    const cut = bash(
      `size=$(stat -c %s '${firstDump}'); head -c $((size / 2)) '${firstDump}' > '${truncated}' && chmod 0600 '${truncated}'`,
    );
    expect(cut.status, cut.stderr).toBe(0);

    const r = budmonLocal(["restore", truncated]);

    // A-447: 14 when the cut breaks the table of contents; a custom-format dump stores it first,
    // so the listing can pass and pg_restore then fails in step 5 (29).
    const out = `${r.stdout}${r.stderr}`;
    expect([14, 29], out).toContain(r.status);
    if (r.status === 29) expect(out).toContain("pg_restore into budmon_restore failed");
    expect(counts()).toBe(seeded);
    expect(await ready()).toBe(200);
    safetyDumpRestores("tp15_22_scratch_1");
  }, 900_000);

  it("TP-15.22 (I2): a valid dump whose pg_restore fails half-way fails with 29 (A-447); budmon keeps the seeded rows, /health/ready is 200, the safety dump restores", async () => {
    // A copy of budmon with a CHECK whose function turns false after the rows are in: pg_dump
    // writes the constraint before the data, so the restore's COPY fails part-way.
    const pg = container("main", "postgres");
    expect(adminSql("CREATE DATABASE tp15_22_craft", "postgres").status).toBe(0);
    const copy = bash(
      `docker exec -u postgres ${pg} bash -c 'pg_dump -Fc -U budmon_admin budmon | pg_restore -U budmon_admin -d tp15_22_craft'`,
    );
    expect(copy.status, copy.stderr).toBe(0);
    for (const sql of [
      "CREATE FUNCTION tp15_22_ok() RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'",
      "ALTER TABLE rate_limit_counters ADD CONSTRAINT tp15_22_check CHECK (tp15_22_ok())",
      "CREATE OR REPLACE FUNCTION tp15_22_ok() RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'",
    ]) {
      const r = adminSql(sql, "tp15_22_craft");
      expect(r.status, r.stderr).toBe(0);
    }
    const crafted = dumpPath("20261012T120200Z");
    const dump = bash(
      `docker exec -u postgres ${pg} pg_dump -Fc -U budmon_admin tp15_22_craft > '${crafted}' && chmod 0600 '${crafted}'`,
    );
    expect(dump.status, dump.stderr).toBe(0);
    adminSql("DROP DATABASE tp15_22_craft", "postgres");

    const r = budmonLocal(["restore", crafted]);

    expect(r.status, `${r.stdout}${r.stderr}`).toBe(29);
    expect(r.stderr).toContain("pg_restore into budmon_restore failed");
    expect(counts()).toBe(seeded);
    expect(await ready()).toBe(200);
    safetyDumpRestores("tp15_22_scratch_2");
  }, 900_000);

  // The restore's rollback on a real runner (PR nit): a second release whose api never becomes
  // ready (its configuration names a key file that doesn't exist, so it exits at start-up).
  it("TP-15.22 (I3): restore of a dump of a release that never becomes ready exits 16; budmon keeps the seeded rows, budmon_restore_failed_<ts> is kept, no marker, and /health/ready is 200 once maintenance is off", async () => {
    const BROKEN = "v0.0.2";
    const git = (args: readonly string[], cwd: string) => {
      const r = sh("git", ["-C", cwd, ...args]);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };
    const compose = path.join(repoDir, "infra/local/compose.main.yaml");
    writeFileSync(
      compose,
      readFileSync(compose, "utf8").replaceAll(
        "CAPTURE_PUBLIC_KEY_FILE: /run/secrets/CAPTURE_PUBLIC_KEY",
        "CAPTURE_PUBLIC_KEY_FILE: /run/secrets/NO_SUCH_KEY",
      ),
    );
    git(["add", "infra/local/compose.main.yaml"], repoDir);
    git(
      ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", BROKEN],
      repoDir,
    );
    git(["push", "-q", "origin", "HEAD:refs/heads/master"], repoDir);
    git(["tag", BROKEN, "master"], origin);
    const dump = path.join(home, "dumps", `20261012T120300Z_${BROKEN}.dump`);
    copyFileSync(firstDump, dump);
    bash(`chmod 0600 '${dump}'`);

    const r = sh(path.join(LOCAL, "budmon-local"), ["restore", dump], {
      env: { ...env(), BUDMON_READY_TIMEOUT: "1" },
      timeoutMs: 1_500_000,
    });

    expect(r.status, `${r.stdout}${r.stderr}`).toBe(16);
    expect(r.stderr).toContain("isn't ready on the restored database");
    expect(counts()).toBe(seeded);
    // The listing goes into the message, so a failure shows what the databases are called.
    const databases = adminSql(
      "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database",
      "postgres",
    ).stdout.trim();
    expect(
      adminSql(
        "SELECT count(*) FROM pg_database WHERE datname ~ '^budmon_restore_failed_[0-9]{8}T[0-9]{6}Z$'",
        "postgres",
      ).stdout.trim(),
      `pg_database: ${databases}`,
    ).not.toBe("0");
    expect(existsSync(path.join(home, "restore.inprogress"))).toBe(false);

    const off = budmonLocal(["maintenance", "off"]);
    expect(off.status, off.stderr).toBe(0);
    let status = 0;
    for (let i = 0; i < 120 && status !== 200; i += 1) {
      status = await ready().catch(() => 0);
      if (status !== 200) await new Promise((res) => setTimeout(res, 1_000));
    }
    expect(status).toBe(200);
  }, 1_700_000);
});

// TP-15.48 (A-502 (2)): a real install with a published port taken fails at once (exit 31), and the
// same install run again, once the port is free, resumes and starts everything, the never-started
// container included. Each case uses its own fresh home and throwaway origin, as TP-15.22 (I) does.
describe.skipIf(!INFRA_INT)("TP-15.48: install with a taken port, then resumed (F-178)", () => {
  const TAG = "v0.0.1";

  interface Prepared {
    work: string;
    home: string;
    run: (args: readonly string[], input?: string) => ReturnType<typeof sh>;
  }

  /** TP-15.22 (I1)'s set-up up to the second install: origin, tag, first install, secrets, site.env. */
  function prepare(): Prepared {
    const work = mkdtempSync(path.join(tmpdir(), "budmon-tp15-48-"));
    const home = path.join(work, "home");
    mkdirSync(home, { mode: 0o700 });
    const origin = path.join(work, "origin.git");
    const repoDir = path.join(work, "repo");
    const git = (args: readonly string[], cwd?: string) => {
      const r = sh("git", cwd === undefined ? args : ["-C", cwd, ...args]);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    git(["init", "-q", "--bare", "-b", "master", origin]);
    git(["config", "receive.shallowUpdate", "true"], origin);
    git(["push", "-q", origin, "HEAD:refs/heads/master"], ROOT);
    git(["clone", "-q", origin, repoDir]);
    const fixture = serverFixture(work);
    try {
      generateBaseline(fixture.dir, TAG);
      cpSync(fixture.drizzle, path.join(repoDir, "apps/server/drizzle"), { recursive: true });
    } finally {
      fixture.remove();
    }
    git(["add", "apps/server/drizzle"], repoDir);
    git(
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "commit",
        "-q",
        "-m",
        `release ${TAG}`,
      ],
      repoDir,
    );
    git(["push", "-q", "origin", "HEAD:refs/heads/master"], repoDir);
    git(["tag", TAG, "master"], origin);
    const run = (args: readonly string[], input?: string) =>
      sh(path.join(LOCAL, "budmon-local"), args, {
        env: { BUDMON_HOME: home, BUDMON_REPO: repoDir },
        ...(input === undefined ? {} : { input }),
        timeoutMs: 1_500_000,
      });
    const first = run(["install", TAG], "laptop.tailnet.ts.net\n");
    if (first.status !== 20) throw new Error(`install 1: ${String(first.status)} ${first.stderr}`);
    const pub = rsaPublicPem();
    const values: Record<string, string> = {
      "main/api/S3_ACCESS_KEY_ID": "access-key-id",
      "main/api/S3_SECRET_ACCESS_KEY": "secret-access-key",
      "main/api/CAPTURE_PUBLIC_KEY": pub,
      "main/api/GOOGLE_SIGNIN_CLIENT_SECRET": "signin-secret",
      "main/worker-general/S3_ACCESS_KEY_ID": "access-key-id",
      "main/worker-general/S3_SECRET_ACCESS_KEY": "secret-access-key",
      "main/worker-general/FX_PRIMARY_APP_ID": "oxr-app-id",
      "main/worker-general/CAPTURE_PUBLIC_KEY": pub,
      "capture/worker-capture/GCP_CREDENTIALS": JSON.stringify({
        type: "service_account",
        project_id: "p",
      }),
      "capture/worker-capture/GOOGLE_OAUTH_CLIENT_SECRET": "oauth-secret",
      "capture/worker-capture/CAPTURE_PUBLIC_KEY": pub,
    };
    for (const [key, value] of Object.entries(values)) {
      const r = run(["secret", "set", key], value);
      if (r.status !== 0) throw new Error(`secret set ${key}: ${r.stderr}`);
    }
    writeFileSync(
      path.join(home, "site.env"),
      [
        "PUBLIC_ORIGIN=https://laptop.tailnet.ts.net",
        "CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1",
        "GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com",
        "S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com",
        "S3_REGION=eu-central-003",
        "S3_BUCKET_EXPORTS=budmon-exports",
        "S3_BUCKET_ERASURE_LOG=budmon-erasure-log",
        "SENTRY_DSN=https://k@sentry.invalid/1",
        "GOOGLE_SIGNIN_CLIENT_ID=123-signin.apps.googleusercontent.com",
        "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS=",
        "GOOGLE_SIGNIN_CALLBACK_ORIGIN=http://localhost:8080",
        "GOOGLE_SIGNIN_APP_ORIGINS=https://laptop.tailnet.ts.net,http://localhost:8080",
        "SMTP_URL=smtp://mailpit:1025",
        "EMAIL_FROM=Budmon <no-reply@budmon.local>",
        "WEB_SENTRY_DSN=https://pub@sentry.invalid/2",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    return { work, home, run };
  }

  /** Removes both projects' containers and networks, the capture network and the work tree. */
  function remove(work: string): void {
    for (const project of ["budmon-main", "budmon-capture"]) {
      const ids = sh("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .stdout.split("\n")
        .filter((id) => id !== "");
      if (ids.length > 0) sh("docker", ["rm", "-f", "-v", ...ids]);
      const nets = sh("docker", [
        "network",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .stdout.split("\n")
        .filter((id) => id !== "");
      if (nets.length > 0) sh("docker", ["network", "rm", ...nets]);
    }
    sh("docker", ["network", "rm", "budmon_capture_db"]);
    sh("sudo", ["rm", "-rf", work]);
  }

  /** A listener holding 127.0.0.1:<port>, as another program on the laptop would. */
  async function hold(port: number): Promise<ChildProcess> {
    const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i += 1) {
      if (sh("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${String(port)}`]).status === 0)
        return child;
      await new Promise((r) => setTimeout(r, 200));
    }
    child.kill("SIGKILL");
    throw new Error(`nothing listens on ${String(port)}`);
  }

  /** `docker compose … <args>` for a project, with the installed release copy's files. */
  const stack = (home: string, project: "main" | "capture", args: readonly string[]) => {
    const release = path.join(home, "releases", TAG);
    return sh(
      "docker",
      [
        "compose",
        "--project-directory",
        release,
        "-p",
        `budmon-${project}`,
        "-f",
        path.join(release, `compose.${project}.yaml`),
        "--env-file",
        path.join(release, "local.env"),
        ...args,
      ],
      { env: { BUDMON_HOME: home, BUDMON_TAG: TAG } },
    );
  };

  const lines = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");

  async function caseFor(port: 8025 | 8080): Promise<void> {
    const prepared = prepare();
    let listener: ChildProcess | undefined;
    try {
      listener = await hold(port);
      const started = Date.now();
      const failed = prepared.run(["install", TAG]);
      const seconds = (Date.now() - started) / 1_000;

      expect(failed.status, `${failed.stdout}${failed.stderr}`).toBe(31);
      expect(seconds).toBeLessThan(60);
      expect(failed.stderr).toContain("budmon-main");
      // A-504: Compose's bind error names the held address; Docker's wording depends on what
      // holds the port (another container, or a host process as here).
      const held = `127.0.0.1:${String(port)}`;
      const bindError = failed.stderr
        .split("\n")
        .find(
          (line) =>
            line.includes(held) &&
            (line.includes("port is already allocated") || line.includes("address already in use")),
        );
      expect(bindError, failed.stderr).toBeDefined();
      expect(existsSync(path.join(prepared.home, "install.inprogress"))).toBe(true);

      listener.kill("SIGKILL");
      listener = undefined;
      await new Promise((r) => setTimeout(r, 500));
      const resumed = prepared.run(["install", TAG]);
      expect(resumed.status, `${resumed.stdout}${resumed.stderr}`).toBe(0);

      expect(stack(prepared.home, "main", ["port", "mailpit", "8025"]).stdout.trim()).toBe(
        "127.0.0.1:8025",
      );
      expect(stack(prepared.home, "main", ["port", "caddy", "8080"]).stdout.trim()).toBe(
        "127.0.0.1:8080",
      );
      expect(
        lines(stack(prepared.home, "main", ["ps", "--status", "running", "--services"]).stdout),
      ).toEqual(expect.arrayContaining(["caddy", "api", "worker-general", "postgres", "mailpit"]));
      expect(
        lines(stack(prepared.home, "capture", ["ps", "--status", "running", "--services"]).stdout),
      ).toContain("worker-capture");
      const probe =
        port === 8025
          ? sh("curl", ["-fsS", "http://127.0.0.1:8025/"])
          : sh("curl", ["-fsS", "http://127.0.0.1:8080/version.json"]);
      expect(probe.status, probe.stderr).toBe(0);
    } finally {
      listener?.kill("SIGKILL");
      remove(prepared.work);
    }
  }

  it("TP-15.48 (a): with 127.0.0.1:8025 held, install exits 31 within 60 s naming budmon-main; freed, install again exits 0 and mailpit is published and running", async () => {
    await caseFor(8025);
  }, 1_800_000);

  it("TP-15.48 (b): the same with 127.0.0.1:8080 held, from a fresh home: caddy is published and serves version.json", async () => {
    await caseFor(8080);
  }, 1_800_000);
});
