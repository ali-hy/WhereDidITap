// devMigrate.ts devMigrateEnv (A-83, A-90) and buildDevMigrateEnv (A-94). TP-2.38 and TP-2.41, plus
// extra cases TP-2.73x and TP-2.79x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// Importing main/devMigrate.ts must not run a migration (an entry guard, as in F-94).
import { describe, expect, it } from "vitest";
import { buildDevMigrateEnv, devMigrateEnv } from "../../../src/main/devMigrate.js";

const MIGRATOR = "budmon_migrator";
const PASSWORD_FILE = ".data/dev-secrets/migrator_password";

describe("TP-2.38: devMigrateEnv", () => {
  it.each([[{}], [{ DB_USER: "x" }], [{ DB_PASSWORD_FILE: "/p" }]])(
    "TP-2.38: for %o it returns a new object and leaves the frozen argument unchanged (A-90)",
    (input: Record<string, string>) => {
      const before = { ...input };
      const frozen = Object.freeze({ ...input });

      const env = devMigrateEnv(frozen);

      expect(env).not.toBe(frozen);
      expect(frozen).toEqual(before);
    },
  );

  it("TP-2.38: an empty environment gets the migrator's user and password file", () => {
    const env = devMigrateEnv({});

    expect(env["DB_USER"]).toBe(MIGRATOR);
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
  });

  it('TP-2.38: DB_USER "x" from the shell is kept', () => {
    const env = devMigrateEnv({ DB_USER: "x" });

    expect(env["DB_USER"]).toBe("x");
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
  });

  it('TP-2.38: DB_PASSWORD_FILE "/p" from the shell is kept', () => {
    const env = devMigrateEnv({ DB_PASSWORD_FILE: "/p" });

    expect(env["DB_PASSWORD_FILE"]).toBe("/p");
    expect(env["DB_USER"]).toBe(MIGRATOR);
  });
});

describe("TP-2.73x: devMigrateEnv, further cases (A-83)", () => {
  it("TP-2.73x: every other variable passes through unchanged", () => {
    const input = { DB_HOST: "localhost", DB_NAME: "budmon", APP_ENV: "development" };

    expect(devMigrateEnv(input)).toEqual({
      ...input,
      DB_USER: MIGRATOR,
      DB_PASSWORD_FILE: PASSWORD_FILE,
    });
  });
});

// A-94: the migrator defaults apply to the shell only; .env fills in the rest, and its api login
// (DB_USER/DB_PASSWORD_FILE) never reaches db:migrate.
describe("TP-2.41: buildDevMigrateEnv", () => {
  function dotEnv(): Record<string, string> {
    return {
      DB_USER: "budmon_app",
      DB_PASSWORD_FILE: ".data/dev-secrets/db_password",
      DB_HOST: "localhost",
    };
  }

  /** Runs buildDevMigrateEnv on frozen copies and checks neither argument changed. */
  function build(shell: Record<string, string>): Record<string, string | undefined> {
    const shellBefore = { ...shell };
    const dotBefore = dotEnv();
    const frozenShell = Object.freeze({ ...shell });
    const frozenDot = Object.freeze(dotEnv());

    const env = buildDevMigrateEnv(frozenShell, frozenDot);

    expect(frozenShell).toEqual(shellBefore);
    expect(frozenDot).toEqual(dotBefore);
    expect(env).not.toBe(frozenShell);
    expect(env).not.toBe(frozenDot);
    return env;
  }

  it("TP-2.41 (a): an empty shell gives the migrator login and .env's DB_HOST", () => {
    const env = build({});

    expect(env["DB_USER"]).toBe(MIGRATOR);
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
    expect(env["DB_HOST"]).toBe("localhost");
  });

  it("TP-2.41 (b): the shell's DB_USER and DB_PASSWORD_FILE win", () => {
    const env = build({ DB_USER: "x", DB_PASSWORD_FILE: "/p" });

    expect(env["DB_USER"]).toBe("x");
    expect(env["DB_PASSWORD_FILE"]).toBe("/p");
  });

  it("TP-2.41 (c): the shell's DB_HOST overrides .env's, and the migrator login stays", () => {
    const env = build({ DB_HOST: "h" });

    expect(env["DB_HOST"]).toBe("h");
    expect(env["DB_USER"]).toBe(MIGRATOR);
    expect(env["DB_PASSWORD_FILE"]).toBe(PASSWORD_FILE);
  });

  it("TP-2.79x: every other .env and shell variable reaches the result, the shell winning", () => {
    const env = buildDevMigrateEnv(
      { DB_NAME: "shell_db", APP_ENV: "test" },
      { DB_NAME: "dot_db", DB_PORT: "5433", DB_USER: "budmon_app" },
    );

    expect(env).toEqual({
      DB_NAME: "shell_db",
      APP_ENV: "test",
      DB_PORT: "5433",
      DB_USER: MIGRATOR,
      DB_PASSWORD_FILE: PASSWORD_FILE,
    });
  });
});
