// The laptop stack's full-stack cases (F-175, F-178), run by the infra-int CI job (A-391, `pnpm
// test:infra`) with real sudo and Docker; skipped elsewhere.
//   - TP-15.3: pg_hba.conf, probed from throwaway clients (the Postgres image's psql) on the right
//     network and address. Only `postgres` is up; the roles get throwaway passwords as budmon_admin,
//     so a rejected case fails at pg_hba.conf, never at the password.
//   - TP-15.28 (I): `budmon-local secret set` with real sudo after F-191; the ownership rows
//     (F-178's layout table) are applied here with sudo, as apply_secret_ownership would, since its
//     calling convention isn't specified.
//   - TP-15.22 (I1, I2): still todo (see the S-15 report).
import { mkdtempSync, readFileSync } from "node:fs";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    for (let i = 0; i < 90; i += 1) {
      if (psqlAdmin("SELECT 1").status === 0) break;
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
});

describe.skipIf(!INFRA_INT)("TP-15.22 (I): install and restore on a real runner (F-178)", () => {
  it.todo("TP-15.22 (I1): a full install, then restore of a dump of a seeded database");
  it.todo("TP-15.22 (I2): restores of a truncated and of a failing dump leave budmon untouched");
});
