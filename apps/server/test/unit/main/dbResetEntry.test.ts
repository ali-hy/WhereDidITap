// TP-2.62x (test-architect addition, not an LLD ID): F-94's entry guard merges <repo>/.env under
// process.env (A-64: the shell wins; .env is never created). It runs `tsx src/main/dbReset.ts`
// from a temporary copy of the server (so serverRoot() finds the copy, and its "repository root"
// holds the test's .env), with node_modules linked to the real ones. Only --seed-only paths that
// open no database connection are used: with no seeders (until S-9) seeding does nothing.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");
const LOCAL_SUPERUSER = "postgres://postgres:postgres@localhost:5432/postgres";

let root = "";
let serverCopy = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "budmon-dbreset-entry-")));
  serverCopy = path.join(root, "apps/server");
  mkdirSync(serverCopy, { recursive: true });
  cpSync(path.join(SERVER_DIR, "src"), path.join(serverCopy, "src"), { recursive: true });
  cpSync(path.join(SERVER_DIR, "package.json"), path.join(serverCopy, "package.json"));
  symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(serverCopy, "node_modules"));
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
  symlinkSync(path.join(REPO_ROOT, "packages"), path.join(root, "packages"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeDotEnv(content: string | undefined): void {
  const file = path.join(root, ".env");
  rmSync(file, { force: true });
  if (content !== undefined) writeFileSync(file, content);
}

function runSeedOnly(shell: Record<string, string>): { status: number | null; stderr: string } {
  const result = spawnSync(
    path.join(SERVER_DIR, "node_modules/.bin/tsx"),
    ["src/main/dbReset.ts", "--seed-only"],
    {
      cwd: serverCopy,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...shell },
      timeout: 60_000,
    },
  );
  return { status: result.status, stderr: result.stderr };
}

describe("TP-2.62x: dbReset's entry guard and <repo>/.env (A-64)", () => {
  it("TP-2.62x: without .env and without DEV_SUPERUSER_URL in the shell it exits 64", () => {
    writeDotEnv(undefined);

    const { status, stderr } = runSeedOnly({});

    expect(status, stderr).toBe(64);
    expect(stderr).toContain("DEV_SUPERUSER_URL is not set");
  });

  it("TP-2.62x: values from <repo>/.env are used (APP_ENV=production there makes db:seed refuse)", () => {
    writeDotEnv(`DEV_SUPERUSER_URL=${LOCAL_SUPERUSER}\nAPP_ENV=production\n`);

    const { status, stderr } = runSeedOnly({});

    expect(status, stderr).toBe(2);
    expect(stderr).toContain("db:seed only runs against a local development or test database");
  });

  it("TP-2.62x: a variable set in the shell wins over .env", () => {
    writeDotEnv(`DEV_SUPERUSER_URL=${LOCAL_SUPERUSER}\nAPP_ENV=production\n`);

    const { status, stderr } = runSeedOnly({ APP_ENV: "development" });

    // The guard passed (production from .env would exit 2 with the phrase). From S-9 seeding then
    // needs a worker configuration and a database (A-72), which this copy doesn't have.
    expect(status, stderr).not.toBe(2);
    expect(stderr).not.toContain("db:seed only runs against a local development or test database");
  });

  // Code review B-2 (round 2): .env is configuration for the CLI only. If it were loaded into
  // process.env, a TESTCONTAINERS=1 line in it would switch off F-20's local-host guard.
  it("TP-2.62x: TESTCONTAINERS=1 in .env doesn't let db:seed reach a non-local host", () => {
    writeDotEnv(
      "TESTCONTAINERS=1\nDEV_SUPERUSER_URL=postgres://p:p@db.example.com:5432/postgres\n",
    );

    const { status, stderr } = runSeedOnly({});

    expect(status, stderr).toBe(2);
    expect(stderr).toContain("db:seed only runs against a local development or test database");
  });

  it("TP-2.62x: the entry guard never creates .env", () => {
    writeDotEnv(undefined);

    runSeedOnly({ DEV_SUPERUSER_URL: LOCAL_SUPERUSER });

    expect(() => realpathSync(path.join(root, ".env"))).toThrow();
  });
});
