// F-6b checkMergeBack: a hotfix (or, from stage 1, infra) merge-back into main. Every committed
// migration applies on an empty database, and none of the hotfix's statements is still pending.
//
// CLI (A-28's direct form, from tools/ci/):
//   ./node_modules/.bin/tsx checkMergeBack.ts --kind hotfix|infra [<added migration file>…]
// Files are repository-relative (`apps/server/drizzle/<name>.sql`). Exit 0 ok, 1 problems,
// 64 usage (including both kinds at once, A-364).
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nodePtySpawn, pendingSchemaReport } from "../../apps/server/tools/releaseMigration.js";
import {
  buildSchemaDatabase,
  startPostgresContainer,
} from "../../apps/server/tools/schemaDatabase.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BREAKPOINT = "--> statement-breakpoint";

const normalise = (sql: string) => sql.replace(/\s+/g, " ").trim();

/** The non-empty statements of a migration, whitespace-normalised. */
function statements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map(normalise)
    .filter((s) => s !== "");
}

/** The repository-relative path of an added migration, inside `serverDir`. */
function inServerDir(serverDir: string, file: string): string {
  const prefix = "apps/server/";
  return path.join(serverDir, file.startsWith(prefix) ? file.slice(prefix.length) : file);
}

export async function checkMergeBack(
  input: {
    serverDir: string;
    kind: "hotfix" | "infra";
    hotfixMigrationFiles: readonly string[];
  },
  deps: {
    startPostgres: () => Promise<{ superuserUrl: string; stop(): Promise<void> }>;
    pendingReport: typeof pendingSchemaReport;
  },
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (input.kind === "infra" && input.hotfixMigrationFiles.length > 0) {
    problems.push(`infra merge-back adds migrations: ${input.hotfixMigrationFiles.join(", ")}`);
  }

  // 1. Every committed migration applies on an empty database.
  const pg = await deps.startPostgres();
  try {
    await buildSchemaDatabase({
      superuserUrl: pg.superuserUrl,
      name: "merge_back",
      mode: "migrate",
      migrationsFolder: path.join(input.serverDir, "drizzle"),
    });
  } catch {
    const files =
      input.hotfixMigrationFiles.length > 0 ? input.hotfixMigrationFiles.join(", ") : "drizzle/";
    problems.push(`migrations don't apply: ${files}`);
  } finally {
    await pg.stop();
  }

  // 2. None of the added statements is still in the pending report.
  const report = await deps.pendingReport(
    { serverDir: input.serverDir },
    { spawnPty: nodePtySpawn },
  );
  const pending = normalise(report.sql);
  for (const file of input.hotfixMigrationFiles) {
    for (const statement of statements(readFileSync(inServerDir(input.serverDir, file), "utf8"))) {
      if (pending.includes(statement)) {
        problems.push(`hotfix change still pending: ${statement.slice(0, 60)}`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

const USAGE = "Usage: checkMergeBack.ts --kind hotfix|infra [<added migration file>…]";

/** The CLI's arguments: exactly one `--kind`, then the files. */
export function parseCheckMergeBackArgs(
  argv: readonly string[],
): { ok: true; kind: "hotfix" | "infra"; files: string[] } | { ok: false; message: string } {
  const kinds: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--kind") {
      const value = argv[i + 1];
      if (value === undefined) return { ok: false, message: "--kind needs a value" };
      kinds.push(value);
      i += 1;
    } else if (arg.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${arg}` };
    } else {
      files.push(arg);
    }
  }
  if (kinds.length !== 1) {
    return { ok: false, message: "exactly one --kind (one merge-back label) is required" };
  }
  const kind = kinds[0];
  if (kind !== "hotfix" && kind !== "infra") {
    return { ok: false, message: `--kind must be hotfix or infra, not ${String(kind)}` };
  }
  return { ok: true, kind, files };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const args = parseCheckMergeBackArgs(process.argv.slice(2));
  if (!args.ok) {
    process.stderr.write(`checkMergeBack: ${args.message}\n${USAGE}\n`);
    process.exitCode = 64;
  } else {
    try {
      const result = await checkMergeBack(
        {
          serverDir: path.join(REPO_ROOT, "apps/server"),
          kind: args.kind,
          hotfixMigrationFiles: args.files,
        },
        { startPostgres: startPostgresContainer, pendingReport: pendingSchemaReport },
      );
      for (const problem of result.problems) process.stderr.write(`${problem}\n`);
      if (result.ok) process.stdout.write("checkMergeBack: ok\n");
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "failed"}\n`);
      process.exitCode = 1;
    }
  }
}
