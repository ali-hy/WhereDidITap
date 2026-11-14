// F-190 scramVerifier against a real Postgres, and F-92's previous-password fallback with a new
// verifier. TP-15.11 (integration part; A-384's re-key, recorded by connection).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrate } from "../../../src/main/migrate.js";
import { bootstrapCluster } from "../../../src/platform/db/clusterBootstrap.js";
import { startFreshPostgres, type FreshPostgres } from "../../support/postgres.js";

type ScramVerifier = (password: string, opts?: { salt?: Buffer; iterations?: number }) => string;
const SCRAM = "../../../../../infra/budmonctl/src/scram.ts";
const loadScram = async () =>
  ((await import(/* @vite-ignore */ SCRAM)) as { scramVerifier: ScramVerifier }).scramVerifier;

const ROLES = ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"];

let db: FreshPostgres;
let dir: string;

beforeAll(async () => {
  db = await startFreshPostgres();
  dir = mkdtempSync(path.join(tmpdir(), "budmon-tp15-11-"));
}, 180_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.stop();
});

async function canLogIn(user: string, password: string, database = "postgres"): Promise<boolean> {
  const client = new pg.Client({ host: db.host, port: db.port, user, password, database });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe("TP-15.11: SCRAM verifiers accepted by Postgres (F-190, F-92)", () => {
  it("TP-15.11: a role whose password is set to scramVerifier(pw) via ALTER ROLE logs in with pw", async () => {
    const scramVerifier = await loadScram();
    const admin = await db.superuserClient();
    try {
      await admin.query("CREATE ROLE tp15_scram LOGIN");
      await admin.query(`ALTER ROLE tp15_scram PASSWORD '${scramVerifier("pw")}'`);
    } finally {
      await admin.end();
    }

    expect(await canLogIn("tp15_scram", "pw")).toBe(true);
    expect(await canLogIn("tp15_scram", "not-pw")).toBe(false);
  });

  it("TP-15.11 (A-384): migrate with DB_PASSWORD new and DB_PASSWORD_PREVIOUS current succeeds through the fallback, re-keys before any other connection, and afterwards only new logs in", async () => {
    const scramVerifier = await loadScram();
    const admin = await db.superuserClient();
    try {
      await bootstrapCluster(admin, { databaseName: "budmon", migrator: { password: "current" } });
    } finally {
      await admin.end();
    }
    const files = {
      DB_PASSWORD_FILE: "new",
      DB_PASSWORD_PREVIOUS_FILE: "current",
      ROLE_SECRETS_FILE: JSON.stringify(
        Object.fromEntries(
          ROLES.map((r) => [
            r,
            { verifier: scramVerifier(r === "budmon_migrator" ? "new" : `pw-${r}`) },
          ]),
        ),
      ),
    };
    const env: Record<string, string> = {
      APP_ENV: "development",
      DB_HOST: db.host,
      DB_PORT: String(db.port),
      DB_NAME: "budmon",
      DB_USER: "budmon_migrator",
    };
    for (const [k, v] of Object.entries(files)) {
      const p = path.join(dir, k.toLowerCase());
      writeFileSync(p, `${v}\n`);
      env[k] = p;
    }
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      });
    // A-384: every connection attempt of the run, by user and password (pool and pg-boss clients
    // are pg.Client instances from the same pg copy).
    const connections: { user: string; password: string }[] = [];
    const proto = pg.Client.prototype as unknown as {
      connect: (...args: unknown[]) => Promise<void>;
    };
    const originalConnect = proto.connect;
    const connectSpy = vi.spyOn(proto, "connect").mockImplementation(function (
      this: { user?: unknown; password?: unknown },
      ...args: unknown[]
    ) {
      connections.push({
        user: String(this.user),
        password: typeof this.password === "string" ? this.password : "<not a string>",
      });
      return originalConnect.apply(this, args);
    });
    let code: number;
    try {
      code = await runMigrate(env);
    } finally {
      spy.mockRestore();
      connectSpy.mockRestore();
    }

    expect(code, written.join("")).toBe(0);
    expect(written.join("")).toContain("migrator_previous_password_used");
    // A-384: one fallback login with the previous password, then only DB_PASSWORD (re-key first).
    const passwords = connections
      .filter((c) => c.user === "budmon_migrator")
      .map((c) => c.password);
    const fallback = passwords.indexOf("current");
    expect(fallback, JSON.stringify(passwords)).toBeGreaterThanOrEqual(0);
    expect(passwords.filter((p) => p === "current")).toHaveLength(1);
    const after = passwords.slice(fallback + 1);
    expect(after.length, JSON.stringify(passwords)).toBeGreaterThan(0);
    expect(
      after.every((p) => p === "new"),
      JSON.stringify(passwords),
    ).toBe(true);
    expect(await canLogIn("budmon_migrator", "new", "budmon")).toBe(true);
    expect(await canLogIn("budmon_migrator", "current", "budmon")).toBe(false);
  }, 180_000);
});
