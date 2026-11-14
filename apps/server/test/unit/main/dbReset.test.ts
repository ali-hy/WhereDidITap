// F-94 runDbResetCli (A-58). TP-2.24 (e) to (g), TP-2.29 and TP-2.16's A-93 cases, plus extra cases
// TP-2.59x, TP-2.68x, TP-2.76x, TP-2.78x, TP-2.81x and TP-2.84x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runDbResetCli, seedAll } from "../../../src/main/dbReset.js";
import { ConfigError } from "../../../src/platform/config/loadConfig.js";
import { createWorkerContainer } from "../../../src/platform/container.js";
import { runSeeders, seeders } from "../../../src/platform/db/seed.js";
import type { WorkerContainer } from "../../support/jobs.js";
import { testWorkerEnv } from "../../support/worker.js";
import {
  ResetRefusedError,
  resetDevelopmentDatabase,
  seedDevelopmentDatabase,
} from "../../../src/platform/db/reset.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");
const SUPERUSER_URL = "postgres://postgres:postgres@localhost:5432/postgres";
const ROLES_JSON = JSON.stringify({
  budmon_app: { password: "a" },
  budmon_capture: { password: "c" },
  budmon_queue: { password: "q" },
  budmon_monitor: { password: "mo" },
  budmon_migrator: { password: "m" },
});

// TP-2.29 (g): a spy in place of the composition root's createWorkerContainer.
vi.mock("../../../src/platform/container.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/platform/container.js")>();
  return { ...actual, createWorkerContainer: vi.fn(actual.createWorkerContainer) };
});

// TP-2.29 (g) (A-278): a spy in place of F-23's runSeeders; the seeder list stays the real one.
vi.mock("../../../src/platform/db/seed.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/platform/db/seed.js")>();
  return { ...actual, runSeeders: vi.fn(() => Promise.resolve()) };
});

type Deps = Parameters<typeof runDbResetCli>[1];
type ResetDeps = Parameters<typeof resetDevelopmentDatabase>[1];

interface Harness {
  deps: Deps;
  reset: ReturnType<typeof vi.fn>;
  seed: ReturnType<typeof vi.fn>;
  seedAll: () => Promise<void>;
  readFile: ReturnType<typeof vi.fn>;
  stderr: string[];
}

function harness(
  env: Record<string, string | undefined> = { DEV_SUPERUSER_URL: SUPERUSER_URL },
  resetBehaviour: () => Promise<void> = () => Promise.resolve(),
): Harness {
  const stderr: string[] = [];
  const reset = vi.fn(resetBehaviour);
  const seed = vi.fn(() => Promise.resolve());
  const readFile = vi.fn(() => ROLES_JSON);
  const seedAll = (): Promise<void> => Promise.resolve();
  const deps = {
    env,
    readFile,
    resetDevelopmentDatabase: reset,
    seedDevelopmentDatabase: seed,
    seedAll,
    stderr: (line: string) => stderr.push(line),
  } as unknown as Deps;
  return { deps, reset, seed, seedAll, readFile, stderr };
}

describe("TP-2.24: runDbResetCli and --seed-only", () => {
  it("TP-2.24 (e): --seed-only calls only seedDevelopmentDatabase, with seedAll, and exits 0", async () => {
    const h = harness();

    const code = await runDbResetCli(["--seed-only"], h.deps);

    expect(code).toBe(0);
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.seed).toHaveBeenCalledWith(
      { appEnv: "development", superuserUrl: SUPERUSER_URL },
      { seed: h.seedAll },
    );
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it("TP-2.24 (f): no arguments calls only resetDevelopmentDatabase, with seed: true", async () => {
    const h = harness();

    const code = await runDbResetCli([], h.deps);

    expect(code).toBe(0);
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({ seed: true });
    expect(h.seed).not.toHaveBeenCalled();
  });

  it("TP-2.24 (g): --seed-only with --no-seed calls neither, prints the message and exits 64 without reading", async () => {
    const h = harness();

    const code = await runDbResetCli(["--seed-only", "--no-seed"], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("--seed-only and --no-seed can't be combined");
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.seed).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });
});

describe("TP-2.29: runDbResetCli arguments and environment", () => {
  it("TP-2.29 (a): an unknown argument exits 64 and reads nothing", async () => {
    const h = harness();

    const code = await runDbResetCli(["--bogus"], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("Unknown argument: --bogus");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.seed).not.toHaveBeenCalled();
  });

  it("TP-2.29 (b): DEV_SUPERUSER_URL unset exits 64 and reads nothing", async () => {
    const h = harness({});

    const code = await runDbResetCli([], h.deps);

    expect(code).toBe(64);
    expect(h.stderr).toContain("DEV_SUPERUSER_URL is not set");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
  });

  it("TP-2.29 (c): defaults: roles from <repo>/.data/dev-secrets/roles.json, database budmon, development", async () => {
    const h = harness();

    await runDbResetCli([], h.deps);

    expect(h.readFile).toHaveBeenCalledWith(path.join(REPO_ROOT, ".data/dev-secrets/roles.json"));
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({
      superuserUrl: SUPERUSER_URL,
      databaseName: "budmon",
      appEnv: "development",
      migratorPassword: "m",
      seed: true,
    });
    expect(h.reset.mock.calls[0]?.[1]).toMatchObject({ seed: h.seedAll });
  });

  it.each([
    ["without TESTCONTAINERS", {}],
    ["with TESTCONTAINERS=1 in env", { TESTCONTAINERS: "1" }],
  ])(
    "TP-2.29 (c): the reset input never carries allowNonLocalHost: true, %s (A-79)",
    async (_label, extra) => {
      const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, ...extra });

      await runDbResetCli([], h.deps);

      expect(h.reset).toHaveBeenCalledTimes(1);
      const resetInput = h.reset.mock.calls[0]?.[0] as Record<string, unknown>;
      expect([undefined, false]).toContain(resetInput.allowNonLocalHost);
    },
  );

  it("TP-2.68x: the --seed-only input never carries allowNonLocalHost: true, with TESTCONTAINERS=1 in env (A-79)", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, TESTCONTAINERS: "1" });

    await runDbResetCli(["--seed-only"], h.deps);

    expect(h.seed).toHaveBeenCalledTimes(1);
    const seedInput = h.seed.mock.calls[0]?.[0] as Record<string, unknown>;
    expect([undefined, false]).toContain(seedInput.allowNonLocalHost);
  });

  it("TP-2.29 (d): --no-seed with APP_ENV=test and DB_NAME=x", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, APP_ENV: "test", DB_NAME: "x" });

    await runDbResetCli(["--no-seed"], h.deps);

    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({
      appEnv: "test",
      databaseName: "x",
      seed: false,
    });
  });

  it("TP-2.29 (e): a ResetRefusedError exits 2 and prints exactly its message, with no failed: line (A-91)", async () => {
    // A real ResetRefusedError, from F-20's own guard.
    const refused: unknown = await seedDevelopmentDatabase(
      { appEnv: "production", superuserUrl: SUPERUSER_URL },
      { seed: () => Promise.resolve() },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ResetRefusedError);
    if (!(refused instanceof ResetRefusedError)) throw new Error("expected a ResetRefusedError");
    const h = harness(undefined, () => Promise.reject(refused));

    expect(await runDbResetCli([], h.deps)).toBe(2);
    expect(h.stderr).toEqual([refused.message]);
    expect(h.stderr.join("\n")).not.toContain("failed:");
  });

  it('TP-2.29 (f): another error, Error("y"), exits 1 and prints exactly "db:reset failed: Error" (A-91)', async () => {
    const h = harness(undefined, () => Promise.reject(new Error("y")));

    expect(await runDbResetCli([], h.deps)).toBe(1);
    expect(h.stderr).toEqual(["db:reset failed: Error"]);
  });

  // TP-2.76x (A-81, A-91): an unexpected failure is one stderr line
  // `<command> failed: <errorClass>[ <errorCode>]`, with no message and no stack trace.

  it('TP-2.76x: a system error from the seed prints "db:seed failed: Error ECONNREFUSED" and exits 1', async () => {
    const h = harness();
    h.seed.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" }),
    );

    expect(await runDbResetCli(["--seed-only"], h.deps)).toBe(1);
    expect(h.stderr).toEqual(["db:seed failed: Error ECONNREFUSED"]);
  });

  it("TP-2.59x: ROLE_SECRETS_FILE, when set, is the file read", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, ROLE_SECRETS_FILE: "/tmp/roles.json" });

    await runDbResetCli([], h.deps);

    expect(h.readFile).toHaveBeenCalledWith("/tmp/roles.json");
  });

  it('TP-2.29 (h): ["--", "--no-seed"] resets with seed: false and exits 0 (A-95)', async () => {
    const h = harness();

    const code = await runDbResetCli(["--", "--no-seed"], h.deps);

    expect(code).toBe(0);
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({ seed: false });
    expect(h.stderr).toEqual([]);
  });

  it.each([
    ["a lone --", ["--"], true],
    ["-- twice around --no-seed", ["--", "--no-seed", "--"], false],
  ])("TP-2.81x: %s is ignored (A-95)", async (_label, argv, seed) => {
    const h = harness();

    expect(await runDbResetCli(argv, h.deps)).toBe(0);
    expect(h.reset.mock.calls[0]?.[0]).toMatchObject({ seed });
  });

  it('TP-2.81x: "--" with --seed-only seeds only (A-95)', async () => {
    const h = harness();

    expect(await runDbResetCli(["--", "--seed-only"], h.deps)).toBe(0);
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('TP-2.81x: an argument that merely starts with "--" is still unknown (A-95)', async () => {
    const h = harness();

    expect(await runDbResetCli(["---"], h.deps)).toBe(64);
    expect(h.stderr).toEqual(["Unknown argument: ---"]);
  });

  // A-72: until S-9 the seeder list was empty and seedAll returned at once. From S-9
  // (platform.fx-rates) it loads the worker configuration and builds a container, so an
  // environment without a worker configuration is refused before any container is built.
  it("TP-2.29 (g): with S-9's platform.fx-rates seeder, the real seedAll loads the worker configuration: an empty environment is a ConfigError and no container is built (A-72)", async () => {
    expect(seeders.map((s) => s.name)).toEqual(["platform.fx-rates"]);

    await expect(seedAll({})).rejects.toBeInstanceOf(ConfigError);

    expect(vi.mocked(createWorkerContainer)).not.toHaveBeenCalled();
  });

  it("TP-2.29 (g) (A-278): seedAll on a development environment without FX_PROVIDER builds one worker container, runs the seeders on it, starts no pg-boss and closes it afterwards", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-seedall-"));
    const order: string[] = [];
    const start = vi.fn(() => Promise.resolve());
    const fake = {
      boss: { start },
      queueBoss: { start },
      captureBoss: { start },
      close: vi.fn(() => {
        order.push("close");
        return Promise.resolve();
      }),
    } as unknown as WorkerContainer;
    vi.mocked(createWorkerContainer).mockClear();
    vi.mocked(createWorkerContainer).mockImplementationOnce(() => fake);
    vi.mocked(runSeeders).mockClear();
    vi.mocked(runSeeders).mockImplementationOnce(() => {
      order.push("seed");
      return Promise.resolve();
    });
    try {
      const env: Record<string, string | undefined> = {
        ...testWorkerEnv(dir, { host: "localhost", port: 5432 }, "budmon", "capture,general"),
        APP_ENV: "development",
      };
      delete env["FX_PROVIDER"];

      await seedAll(env);

      expect(vi.mocked(createWorkerContainer)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createWorkerContainer).mock.calls[0]?.[0].fx).toEqual({ provider: "fixed" });
      expect(vi.mocked(runSeeders)).toHaveBeenCalledWith(fake);
      expect(order).toEqual(["seed", "close"]);
      expect(start).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TP-2.84x (A-278): a seeder failure still closes the container, and seedAll rejects", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-seedall-"));
    const close = vi.fn(() => Promise.resolve());
    vi.mocked(createWorkerContainer).mockImplementationOnce(
      () => ({ close }) as unknown as WorkerContainer,
    );
    vi.mocked(runSeeders).mockImplementationOnce(() => Promise.reject(new Error("seed failed")));
    try {
      const env = {
        ...testWorkerEnv(dir, { host: "localhost", port: 5432 }, "budmon", "capture,general"),
        APP_ENV: "development",
      };

      await expect(seedAll(env)).rejects.toThrow("seed failed");
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// TP-2.16 (A-93): an unknown APP_ENV is refused with a fixed phrase that never repeats the value.
// The fake reset delegates to the real F-20 with recording dependencies, so the case holds
// whether runDbResetCli or F-20 does the refusing.
const UNKNOWN_APP_ENV_LINE =
  "db:reset only runs against a local development or test database: APP_ENV is not a known environment";

describe("TP-2.16 (A-93): an unknown APP_ENV through runDbResetCli", () => {
  it.each([
    ["a value with a newline", "secret\nINJECTED", ["secret", "INJECTED"]],
    ["staging", "staging", ["staging"]],
  ])("TP-2.16: APP_ENV %s exits 2 with exactly the fixed line", async (_label, appEnv, secrets) => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, APP_ENV: appEnv });
    const runSchemaStep = vi.fn<ResetDeps["runSchemaStep"]>();
    const seed = vi.fn(() => Promise.resolve());
    const deps: Deps = {
      ...h.deps,
      resetDevelopmentDatabase: (input) => resetDevelopmentDatabase(input, { runSchemaStep, seed }),
    };

    const code = await runDbResetCli([], deps);

    expect(code).toBe(2);
    expect(h.stderr).toEqual([UNKNOWN_APP_ENV_LINE]);
    for (const secret of secrets) expect(h.stderr.join("\n")).not.toContain(secret);
    expect(runSchemaStep).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  it("TP-2.78x: --seed-only with APP_ENV=staging exits 2 with the db:seed form of the line", async () => {
    const h = harness({ DEV_SUPERUSER_URL: SUPERUSER_URL, APP_ENV: "staging" });
    const seed = vi.fn(() => Promise.resolve());
    const deps: Deps = {
      ...h.deps,
      seedDevelopmentDatabase: (input) => seedDevelopmentDatabase(input, { seed }),
    };

    const code = await runDbResetCli(["--seed-only"], deps);

    expect(code).toBe(2);
    expect(h.stderr).toEqual([
      "db:seed only runs against a local development or test database: APP_ENV is not a known environment",
    ]);
    expect(seed).not.toHaveBeenCalled();
  });
});
