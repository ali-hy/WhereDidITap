// TP-0.21: the root package.json scripts are exactly §2.2.2's rows for the slices built so far
// (A-14). Each later slice adds its rows to ROWS (and replaces a command where §2.2.2 says so),
// so a script can't appear before its owning slice.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** §2.2.2 rows owned by the slices built so far: script → root command. */
const ROWS: Readonly<Record<string, string>> = {
  // S-0 (format to test:int)
  format: "prettier --write .",
  "format:check": "prettier --check .",
  // S-11a (A-14, A-316): lint also runs lint:css and lint:catalogs.
  lint: "eslint . && pnpm lint:css && pnpm lint:catalogs",
  // S-2, S-11a (A-30): typecheck also checks apps/server and apps/web.
  typecheck:
    "tsc -p tsconfig.json && tsc -p apps/server/tsconfig.json && tsc -p apps/web/tsconfig.json",
  test: "vitest run --project=!server-int",
  "test:int": "vitest run --project=server-int",
  // S-1 (A-35): test:coverage added; check runs it after test.
  "test:coverage": "vitest run --project=shared --coverage",
  check:
    "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm test:int",
  // S-2 (A-14)
  dev: "pnpm --filter @budmon/server dev",
  "db:reset": "pnpm --filter @budmon/server db:reset",
  "db:seed": "pnpm --filter @budmon/server db:seed",
  "db:migrate": "pnpm --filter @budmon/server db:migrate",
  // S-4 (A-14)
  "contract:openapi": "pnpm --filter @budmon/contract contract:openapi",
  // S-11a (A-14, F-4)
  "lint:css": 'stylelint "apps/web/src/**/*.css"',
  // S-11a (A-316, F-9)
  "lint:catalogs": "pnpm --filter @budmon/tools-ci lint:catalogs",
  // S-11b (A-14)
  "test:e2e": "pnpm --filter @budmon/web test:e2e",
  // S-14 (A-14)
  "db:release-migration": "pnpm --filter @budmon/server db:release-migration",
  "db:pending-report": "pnpm --filter @budmon/server db:pending-report",
  "db:check-migrations": "pnpm --filter @budmon/server db:check-migrations",
  "db:check-risky": "pnpm --filter @budmon/server db:check-risky",
  // S-15 (A-14)
  "test:bats":
    "bash infra/local/test/setup-bats.sh && .tools/bats/bats-core/bin/bats infra/local/test",
  // A-391: the infra-int job's integration tests.
  "test:infra": "bash infra/local/test/run-integration.sh",
  // S-13 (A-14): check:all also runs Android's checks.
  "check:all": "pnpm check && pnpm test:e2e && cd apps/android && ./gradlew check",
};

/** §2.2.2's package-script column for apps/server, plus F-24's build (A-43). */
const SERVER_SCRIPTS: Readonly<Record<string, string>> = {
  dev: "tsx src/main/dev.ts",
  "db:reset": "tsx src/main/dbReset.ts",
  "db:seed": "tsx src/main/dbReset.ts --seed-only",
  // A-83: the development wrapper.
  "db:migrate": "tsx src/main/devMigrate.ts",
  build: "tsx scripts/build.ts",
  // S-14 (A-14)
  "db:release-migration": "tsx tools/releaseMigration.ts generate",
  "db:pending-report": "tsx tools/releaseMigration.ts pending",
  "db:check-migrations": "tsx tools/checkMigrations.ts",
  "db:check-risky": "tsx tools/checkRisky.ts",
  // A-368: F-183 runs through the package script.
  "test:upgrade": "tsx test/upgrade/harness.ts",
};

function rootScripts(): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  return pkg.scripts ?? {};
}

describe("TP-0.21: root scripts (§2.2.2)", () => {
  it("TP-0.21: every root script is a §2.2.2 row of a built slice, with that row's command", () => {
    const scripts = rootScripts();
    const unexpected = Object.keys(scripts).filter((name) => !(name in ROWS));

    expect(unexpected).toEqual([]);
    for (const [name, command] of Object.entries(scripts)) {
      if (name in ROWS) expect({ [name]: command }).toEqual({ [name]: ROWS[name] });
    }
  });

  it.each(Object.keys(ROWS).map((name) => [name]))(
    "TP-0.21: the script %s of a built slice is present",
    (name) => {
      expect(Object.keys(rootScripts())).toContain(name);
    },
  );
});

// TP-0.26x (test-architect addition, not an LLD ID): the root scripts that delegate to
// @budmon/server find the package script §2.2.2 names.
describe("TP-0.26x: apps/server package scripts (§2.2.2, F-24)", () => {
  it.each(Object.entries(SERVER_SCRIPTS))("TP-0.26x: %s is %j", (name, command) => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "apps/server/package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    expect(pkg.scripts?.[name]).toBe(command);
  });
});

// TP-0.26x: the contract package's script that the root contract:openapi delegates to (§2.2.2).
describe("TP-0.26x: packages/contract package scripts (§2.2.2, F-347)", () => {
  it('TP-0.26x: contract:openapi is "tsx scripts/emitOpenapi.ts"', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "packages/contract/package.json"), "utf8"),
    ) as { name?: string; scripts?: Record<string, unknown> };

    expect(pkg.name).toBe("@budmon/contract");
    expect(pkg.scripts?.["contract:openapi"]).toBe("tsx scripts/emitOpenapi.ts");
  });
});

// TP-0.26x: the web package's script that the root test:e2e delegates to (§2.2.2, S-11b).
describe("TP-0.26x: apps/web package scripts (§2.2.2, S-11b)", () => {
  it('TP-0.26x: test:e2e is "playwright test"', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8")) as {
      name?: string;
      scripts?: Record<string, unknown>;
    };

    expect(pkg.name).toBe("@budmon/web");
    expect(pkg.scripts?.["test:e2e"]).toBe("playwright test");
  });
});
