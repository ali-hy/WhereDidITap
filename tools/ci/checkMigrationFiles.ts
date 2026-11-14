// F-6: migration files change only on release/* and hotfix/* branches (D-12). Also the CLI that
// `ci.yml`'s `migrations` job runs (A-7).
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface CheckMigrationFilesInput {
  branch: string;
  changedFiles: readonly string[];
  isHotfixMergeBack: boolean;
}

export function checkMigrationFiles(
  input: CheckMigrationFilesInput,
): { ok: true } | { ok: false; message: string } {
  if (/^(release|hotfix|infra)\//.test(input.branch) || input.isHotfixMergeBack) {
    return { ok: true };
  }
  // The folder's placeholder isn't a migration file (A-92); every other path under it counts.
  const migrations = input.changedFiles.filter(
    (file) => file.startsWith("apps/server/drizzle/") && file !== "apps/server/drizzle/.gitkeep",
  );
  if (migrations.length > 0) {
    return {
      ok: false,
      message: `Migration files may only change on release/* and hotfix/* branches (D-12): ${migrations.join(", ")}. Move these changes to a release/* or hotfix/* branch, or remove them from this pull request.`,
    };
  }
  return { ok: true };
}

export function parseCheckMigrationFilesArgs(
  argv: readonly string[],
):
  | { ok: true; branch: string; changedFilesPath: string; isHotfixMergeBack: boolean }
  | { ok: false; message: string } {
  let branch: string | undefined;
  let changedFilesPath: string | undefined;
  let isHotfixMergeBack = false;
  let seenMergeBack = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--hotfix-merge-back") {
      if (seenMergeBack) return { ok: false, message: `Duplicate argument: ${token}` };
      seenMergeBack = true;
      isHotfixMergeBack = true;
    } else if (token === "--branch" || token === "--changed-files") {
      if ((token === "--branch" ? branch : changedFilesPath) !== undefined) {
        return { ok: false, message: `Duplicate argument: ${token}` };
      }
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return { ok: false, message: `Missing value for ${token}` };
      }
      i++;
      if (token === "--branch") branch = value;
      else changedFilesPath = value;
    } else {
      return { ok: false, message: `Unknown argument: ${token}` };
    }
  }

  if (branch === undefined) return { ok: false, message: "Missing required argument: --branch" };
  if (changedFilesPath === undefined) {
    return { ok: false, message: "Missing required argument: --changed-files" };
  }
  return { ok: true, branch, changedFilesPath, isHotfixMergeBack };
}

export function parseChangedFiles(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line !== "");
}

export function runCheckMigrationFilesCli(
  argv: readonly string[],
  deps: {
    readFile: (path: string) => string;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
  },
): number {
  const args = parseCheckMigrationFilesArgs(argv);
  if (!args.ok) {
    deps.stderr(`checkMigrationFiles: ${args.message}`);
    deps.stderr(
      "Usage: checkMigrationFiles.ts --branch <head ref> --changed-files <file> [--hotfix-merge-back]",
    );
    return 64;
  }

  let text: string;
  try {
    text = deps.readFile(args.changedFilesPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.stderr(`checkMigrationFiles: cannot read ${args.changedFilesPath}: ${reason}`);
    return 64;
  }

  const changedFiles = parseChangedFiles(text);
  const result = checkMigrationFiles({
    branch: args.branch,
    changedFiles,
    isHotfixMergeBack: args.isHotfixMergeBack,
  });
  if (!result.ok) {
    deps.stderr(result.message);
    return 1;
  }
  const n = changedFiles.length;
  deps.stdout(`checkMigrationFiles: ok (${String(n)} changed file${n === 1 ? "" : "s"})`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = runCheckMigrationFilesCli(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, "utf8"),
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  });
}
