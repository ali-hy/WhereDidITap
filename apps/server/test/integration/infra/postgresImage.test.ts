// The Postgres image (F-170) under the laptop's Compose service definition (F-175): boot
// safeguards, peer login for budmon_admin, and logs that never carry statement text or values.
// TP-15.1, TP-15.1b, TP-15.2. Builds images/postgres; creates (and removes) its own Compose project
// and, when missing, the external network budmon_capture_db.
import { chownSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImage, compose, laptopHome, sh, TEST_TAG, tlsPair } from "./support.js";

const PROJECT = `budmon-tp15-pg-${String(process.pid)}`;
const MIGRATOR_PASSWORD = "migrator-pw-tp15";
const CANARY = "CANARY-pg-log-tp-15-2-7f3a";

/** A SCRAM-SHA-256 verifier (RFC 7677), computed here so the test doesn't need budmonctl. */
function verifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const stored = createHash("sha256").update(clientKey).digest("base64");
  const server = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`;
}

function chown999(p: string): void {
  try {
    chownSync(p, 999, 999);
  } catch {
    const r = sh("sudo", ["chown", "-R", "999:999", p]);
    if (r.status !== 0) throw new Error(`chown 999 ${p}: ${r.stderr}`);
  }
}

let home = "";
let createdNetwork = false;

beforeAll(() => {
  buildImage("postgres");
  const scratch = mkdtempSync(path.join(tmpdir(), "budmon-tp15-tls-"));
  const { cert, key } = tlsPair(scratch);
  home = laptopHome({
    ADMIN_PASSWORD: "admin-pw-tp15",
    MIGRATOR_VERIFIER: verifier(MIGRATOR_PASSWORD),
    TLS_CERT: readFileSync(cert, "utf8"),
    TLS_KEY: readFileSync(key, "utf8"),
  });
  rmSync(scratch, { recursive: true, force: true });
  for (const p of [path.join(home, "pg"), path.join(home, "secrets/main/postgres")]) {
    sh("chmod", ["-R", "u+rwX", p]);
    chown999(p);
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
}, 1_500_000);

afterAll(() => {
  if (home === "") return;
  compose(PROJECT, home, ["down", "-v", "--remove-orphans"]);
  if (createdNetwork) sh("docker", ["network", "rm", "budmon_capture_db"]);
  sh("sudo", ["rm", "-rf", home]);
  rmSync(home, { recursive: true, force: true });
});

const psqlAdmin = (sql: string, extra: readonly string[] = []) =>
  compose(PROJECT, home, [
    "exec",
    "-T",
    "-u",
    "postgres",
    "postgres",
    "psql",
    "-U",
    "budmon_admin",
    ...extra,
    "-tAc",
    sql,
  ]);

async function waitReady(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const r = compose(PROJECT, home, [
      "exec",
      "-T",
      "-u",
      "postgres",
      "postgres",
      "pg_isready",
      "-U",
      "budmon_admin",
    ]);
    if (r.status === 0) return;
    await new Promise((res) => setTimeout(res, 1_000));
  }
  throw new Error("postgres never became ready");
}

describe("TP-15.1: boot safeguards (F-170)", () => {
  it("TP-15.1: an empty data directory without BUDMON_FIRST_SETUP=1 exits 70 with the message", () => {
    const r = compose(PROJECT, home, ["run", "--rm", "--no-deps", "postgres"]);

    expect(r.status, `${r.stdout}${r.stderr}`).toBe(70);
    expect(`${r.stdout}${r.stderr}`).toContain(
      "Refusing to initialise an empty data directory without BUDMON_FIRST_SETUP=1",
    );
  }, 300_000);

  it("TP-15.1: with BUDMON_FIRST_SETUP=1 it initialises: budmon_migrator exists and owns budmon", async () => {
    const up = compose(PROJECT, home, ["up", "-d", "postgres"], { BUDMON_FIRST_SETUP: "1" });
    expect(up.status, up.stderr).toBe(0);
    await waitReady();

    expect(
      psqlAdmin("SELECT rolname FROM pg_roles WHERE rolname = 'budmon_migrator'").stdout.trim(),
    ).toBe("budmon_migrator");
    expect(
      psqlAdmin(
        "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'budmon'",
      ).stdout.trim(),
    ).toBe("budmon_migrator");
  }, 300_000);

  it("TP-15.1: restarted with data (and no flag) it starts", async () => {
    compose(PROJECT, home, ["stop", "postgres"]);
    const up = compose(PROJECT, home, ["up", "-d", "postgres"]);
    expect(up.status, up.stderr).toBe(0);
    await waitReady();

    expect(psqlAdmin("SELECT 1").stdout.trim()).toBe("1");
  }, 300_000);

  it("TP-15.1: without a mounted /var/lib/postgresql/data it exits 70 with the message", () => {
    const r = sh("docker", ["run", "--rm", `budmon/postgres:${TEST_TAG}`]);

    expect(r.status).toBe(70);
    expect(`${r.stdout}${r.stderr}`).toContain("Refusing to start: data mount missing");
  }, 120_000);
});

describe("TP-15.1b: peer login for budmon_admin (F-170)", () => {
  it("TP-15.1b: as OS user postgres, psql -U budmon_admin works without a password", () => {
    const r = psqlAdmin("SELECT 'peer-ok'");

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("peer-ok");
  });

  it("TP-15.1b: as another OS user, psql -U budmon_admin is rejected", () => {
    const r = compose(
      PROJECT,
      home,
      ["exec", "-T", "-u", "65534", "postgres", "psql", "-U", "budmon_admin", "-tAc", "SELECT 1"],
      {
        PGPASSWORD: "admin-pw-tp15",
      },
    );

    expect(r.status).not.toBe(0);
  });

  it("TP-15.1b: psql -h 127.0.0.1 -U budmon_admin is rejected", () => {
    const r = compose(PROJECT, home, [
      "exec",
      "-T",
      "-u",
      "postgres",
      "-e",
      "PGPASSWORD=admin-pw-tp15",
      "postgres",
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "budmon_admin",
      "-tAc",
      "SELECT 1",
    ]);

    expect(r.status).not.toBe(0);
  });
});

describe("TP-15.2: Postgres logs don't leak (F-170 configuration)", () => {
  it("TP-15.2: as budmon_app, an INSERT violating a check with a canary value logs an error without the canary or the statement", () => {
    for (const sql of [
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budmon_app') THEN CREATE ROLE budmon_app LOGIN PASSWORD 'app-pw-tp15'; END IF; END $$",
      "CREATE TABLE IF NOT EXISTS public.tp15_probe (v text CHECK (char_length(v) < 5))",
      "GRANT INSERT ON public.tp15_probe TO budmon_app",
      "GRANT CONNECT ON DATABASE budmon TO budmon_app",
      "GRANT USAGE ON SCHEMA public TO budmon_app",
    ]) {
      const r = psqlAdmin(sql, ["-d", "budmon"]);
      expect(r.status, `${sql}: ${r.stderr}`).toBe(0);
    }
    const since = new Date().toISOString();

    const insert = compose(PROJECT, home, [
      "exec",
      "-T",
      "-u",
      "postgres",
      "postgres",
      "psql",
      `host=172.30.40.10 dbname=budmon user=budmon_app password=app-pw-tp15 sslmode=require`,
      "-c",
      `INSERT INTO public.tp15_probe (v) VALUES ('${CANARY}')`,
    ]);
    expect(insert.status).not.toBe(0);

    const logs = compose(PROJECT, home, ["logs", "--no-log-prefix", "--since", since, "postgres"]);
    const text = `${logs.stdout}${logs.stderr}`;
    expect(text).toMatch(/ERROR/);
    expect(text).not.toContain(CANARY);
    expect(text).not.toMatch(/INSERT INTO/i);
    expect(text).not.toMatch(/STATEMENT:/);
  }, 120_000);
});
