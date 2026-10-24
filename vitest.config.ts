// Root Vitest configuration (LLD §10.1). Owned by the test-architect.
//
// Projects are declared through `test.projects`, with no `vitest.workspace.*` file: Vitest 4 removed
// workspace files and 5.0.3 throws on them (A-8).
//
// Projects are added as their slices create them: `web-unit` (jsdom, @solidjs/testing-library,
// MSW) came with S-11a; `server-int`'s `globalSetup` (Testcontainers Postgres) with S-2.
//
// Root scripts (§2.2.2): `pnpm test` = `vitest run --project=!server-int`;
// `pnpm test:int` = `vitest run --project=server-int`;
// `pnpm test:coverage` = `vitest run --project=shared --coverage` (A-35).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several projects have no test files until their slice is built (S-1, S-2, S-4).
    passWithNoTests: true,
    // A-35: `pnpm test:coverage` (vitest run --project=shared --coverage) requires 100 % of the
    // branches in packages/shared/src/money/**. Nothing else is measured.
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/money/**"],
      reporter: ["text-summary"],
      reportsDirectory: "coverage",
      thresholds: { "packages/shared/src/money/**": { branches: 100 } },
    },
    projects: [
      {
        test: {
          name: "shared",
          environment: "node",
          include: ["packages/shared/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "contract",
          environment: "node",
          include: ["packages/contract/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server-unit",
          environment: "node",
          include: ["apps/server/test/unit/**/*.test.ts"],
          // TP-2.27 runs esbuild over the server, and the config tests generate RSA keys.
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "server-int",
          environment: "node",
          // S-3: the privacy canary suite (§10.1, apps/server/test/privacy/) runs here too.
          include: [
            "apps/server/test/integration/**/*.test.ts",
            "apps/server/test/privacy/**/*.test.ts",
          ],
          // §10.1: one Postgres (Testcontainers, or TEST_DATABASE_URL) with budmon_template built
          // by bootstrapCluster + runSchemaStep; each test file copies it (createTestDatabase).
          globalSetup: ["apps/server/test/setup/globalSetup.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
      {
        // S-11a: components and i18n in jsdom, through the web app's Vite config (Solid's plugin).
        // A-310: pseudo-locale catalogs are generated before the run, and pseudo-locales are on.
        extends: "./apps/web/vite.config.ts",
        root: "apps/web",
        test: {
          name: "web-unit",
          environment: "jsdom",
          include: ["test/**/*.test.{ts,tsx}"],
          globalSetup: ["test/setup/pseudoLocales.ts"],
          // Unmounts renders after each test (globals are off, so the library can't do it itself).
          setupFiles: ["test/setup/cleanup.ts"],
          env: { VITE_PSEUDO_LOCALES: "1" },
          server: { deps: { inline: [/[\\/]msw[\\/]/, /@mswjs[\\/]interceptors/] } },
        },
      },
      {
        test: {
          name: "tools",
          environment: "node",
          include: [
            "tools/*/test/**/*.test.ts",
            "infra/budmonctl/test/**/*.test.ts",
            "packages/config/test/**/*.test.ts",
            // S-3: @budmon/test-support's own tests (F-198, TP-16.1).
            "packages/test-support/test/**/*.test.ts",
          ],
          // Type-aware ESLint and `tsc` runs start a TypeScript program per test.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
