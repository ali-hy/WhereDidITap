// F-183: the upgrade test harness (test-architect; A-368). For release vN it builds the previous
// release's database from the migrations at the previous release tag, loads
// test/upgrade/<vN>/fixtures.sql, applies the current migrations and runs
// test/upgrade/<vN>/*.test.ts against the result.
//   - The previous tag is `git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD`.
//   - No tag (every PR until the first release): "skipped: baseline", exit 0.
//   - A tag but no test/upgrade/<vN>/ folder: the previous schema is migrated to HEAD with no
//     fixtures and no tests, and the harness passes when that succeeds.
//
// CLI (package script `test:upgrade`): tsx test/upgrade/harness.ts --version <vN> [--repo <dir>]
// A-411: --version is required and must be a release or hotfix version (CI passes the head branch's
// suffix); otherwise exit 64 with the usage. Exit 0 when skipped or passed, 1 otherwise.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapCluster } from "../../src/platform/db/clusterBootstrap.js";
import { runSchemaStep } from "../../src/platform/db/schemaStep.js";
import { connectDatabase, recordingLogger, schemaStepInput } from "../support/platform.js";
import {
  startFreshPostgres,
  TEST_ROLE_PASSWORDS,
  type FreshPostgres,
} from "../support/postgres.js";

export type UpgradeResult =
  | { status: "skipped: baseline" }
  | { status: "ran"; previousTag: string; fixtures: boolean; tests: boolean };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DRIZZLE = "apps/server/drizzle";

/** The most recent tag `v[0-9]*` reachable from `ref`, or null if there's none (A-368). */
export function previousReleaseTag(repoDir: string, ref = "HEAD"): string | null {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", ref], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** apps/server/drizzle at `tag`, written into a temporary folder (empty if the tag has none). */
function migrationsAt(repoDir: string, tag: string): string {
  const out = mkdtempSync(path.join(tmpdir(), "budmon-upgrade-prev-"));
  let files: string[] = [];
  try {
    files = execFileSync("git", ["ls-tree", "-r", "--name-only", tag, `${DRIZZLE}/`], {
      cwd: repoDir,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f !== "");
  } catch {
    files = [];
  }
  for (const file of files) {
    const target = path.join(out, path.relative(DRIZZLE, file));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", `${tag}:${file}`], { cwd: repoDir }));
  }
  return out;
}

/** A-411: the versions --version accepts (the head branch's suffix for release and hotfix). */
export const VERSION = /^v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$/;

export async function runUpgradeHarness(opts: {
  repoDir: string;
  version: string;
  ref?: string;
  startPostgres?: () => Promise<FreshPostgres>;
}): Promise<UpgradeResult> {
  if (!VERSION.test(opts.version)) throw new RangeError(`invalid version: ${opts.version}`);
  const previousTag = previousReleaseTag(opts.repoDir, opts.ref);
  if (previousTag === null) return { status: "skipped: baseline" };

  const caseDir = path.join(opts.repoDir, "apps/server/test/upgrade", opts.version);
  const hasCase = existsSync(caseDir);
  const previous = migrationsAt(opts.repoDir, previousTag);
  const pg = await (opts.startPostgres ?? startFreshPostgres)();
  try {
    const admin = await pg.superuserClient();
    try {
      await bootstrapCluster(admin, {
        databaseName: "budmon",
        migrator: { password: TEST_ROLE_PASSWORDS.budmon_migrator },
      });
    } finally {
      await admin.end();
    }
    const migrator = connectDatabase(
      pg,
      "budmon_migrator",
      TEST_ROLE_PASSWORDS.budmon_migrator,
      "budmon",
    );
    try {
      // The previous release's database.
      await runSchemaStep(schemaStepInput(migrator, "migrate", recordingLogger(), previous));
      if (hasCase) {
        const fixtures = path.join(caseDir, "fixtures.sql");
        if (existsSync(fixtures)) {
          const client = await pg.superuserClient("budmon");
          try {
            await client.query(readFileSync(fixtures, "utf8"));
          } finally {
            await client.end();
          }
        }
      }
      // The current migrations on top.
      await runSchemaStep(
        schemaStepInput(migrator, "migrate", recordingLogger(), path.join(opts.repoDir, DRIZZLE)),
      );
    } finally {
      await migrator.close();
    }
    let tests = false;
    if (hasCase) {
      const testFiles = readdirSync(caseDir).filter((f) => f.endsWith(".test.ts"));
      if (testFiles.length > 0) {
        tests = true;
        const run = spawnSync(
          path.join(opts.repoDir, "node_modules/.bin/vitest"),
          ["run", "--root", caseDir, ...testFiles],
          {
            cwd: opts.repoDir,
            stdio: "inherit",
            env: { ...process.env, UPGRADE_DATABASE_URL: pg.superuserUrl("budmon") },
          },
        );
        if (run.status !== 0) throw new Error(`upgrade tests for ${opts.version} failed`);
      }
    }
    return { status: "ran", previousTag, fixtures: hasCase, tests };
  } finally {
    await pg.stop();
    rmSync(previous, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const version = arg("--version");
  if (version === undefined || !VERSION.test(version)) {
    process.stderr.write("usage: test:upgrade --version <vX.Y.Z[-hotfix.N]> [--repo <dir>]\n");
    process.exitCode = 64;
  } else {
    try {
      const result = await runUpgradeHarness({ repoDir: arg("--repo") ?? REPO_ROOT, version });
      process.stdout.write(
        result.status === "ran" ? `ran from ${result.previousTag}\n` : `${result.status}\n`,
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
