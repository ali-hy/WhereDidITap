// F-180 generateReleaseMigration and F-181 pendingSchemaReport: drizzle-kit generate under a pty,
// answering its create-or-rename prompts with "create" and listing them as ambiguities.
//
// CLI (package scripts): `tsx tools/releaseMigration.ts generate <version>` prints the new file's
// path (or nothing when there are no changes); `tsx tools/releaseMigration.ts pending` prints the
// pending SQL. Both print the ambiguities on stderr.
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The parts of node-pty's IPty that F-180 uses. */
export interface PtyLike {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  kill(signal?: string): void;
}

/** node-pty's `spawn` (injected). */
export type SpawnPty = (
  file: string,
  args: string[] | string,
  options: {
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
    name?: string;
  },
) => PtyLike;

const VERSION = /^v\d+\.\d+\.\d+(-hotfix\.\d+)?$/;
const QUESTION =
  /created or renamed|renamed from another|create (table|column|enum|sequence|view)/i;
const DEFAULT_TIMEOUT_MS = 120_000;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*\u0007|[@-Z\\-_])/g;

function sqlFiles(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith(".sql")));
  } catch {
    return new Set();
  }
}

/** Runs `drizzle-kit generate --name <name>` in `dir`, answering prompts. */
async function generate(
  dir: string,
  name: string,
  timeoutMs: number,
  spawnPty: SpawnPty,
): Promise<{ file: string | null; ambiguities: string[] }> {
  const drizzleDir = path.join(dir, "drizzle");
  const before = sqlFiles(drizzleDir);
  const ambiguities: string[] = [];
  let output = "";
  /** Where the next prompt is looked for: after the last one answered. */
  let scanFrom = 0;

  const pty = spawnPty("pnpm", ["exec", "drizzle-kit", "generate", "--name", name], {
    cols: 80,
    rows: 24,
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    name: "xterm",
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      pty.kill();
      reject(new Error("generate timed out"));
    }, timeoutMs);
    pty.onData((data) => {
      output += data.replace(ANSI, "");
      // A question line followed by a selection list (its "❯" pointer) is a prompt.
      const pending = output.slice(scanFrom);
      const lines = pending.split(/\r?\n/);
      const questionAt = lines.findIndex((l) => QUESTION.test(l));
      if (questionAt < 0) return;
      const listAt = lines.findIndex((l, i) => i > questionAt && l.includes("❯"));
      if (listAt < 0) return;
      ambiguities.push((lines[questionAt] ?? "").trim());
      pty.write("\r");
      scanFrom = output.length;
    });
    pty.onExit(({ exitCode: code }) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw Object.assign(new Error("drizzle-kit generate failed"), { exitCode });
  }
  if (/No schema changes/i.test(output)) return { file: null, ambiguities };
  const created = [...sqlFiles(drizzleDir)].filter((f) => !before.has(f)).sort();
  const file = created.find((f) => f.endsWith(`_${name}.sql`)) ?? created.at(-1);
  // A-362: absolute.
  return { file: file === undefined ? null : path.resolve(dir, "drizzle", file), ambiguities };
}

/** F-180: the release's migration file, generated in serverDir/drizzle. */
export async function generateReleaseMigration(
  input: { version: string; serverDir: string; timeoutMs?: number },
  deps: { spawnPty: SpawnPty },
): Promise<{ file: string | null; ambiguities: string[] }> {
  if (!VERSION.test(input.version)) {
    throw new RangeError("version must be vX.Y.Z or vX.Y.Z-hotfix.N");
  }
  return generate(
    input.serverDir,
    input.version,
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    deps.spawnPty,
  );
}

/**
 * F-181: the SQL a release would generate now, from a temporary copy (drizzle/ and
 * drizzle.config.ts copied, everything else linked), so the repository is never written.
 */
export async function pendingSchemaReport(
  input: { serverDir: string; timeoutMs?: number },
  deps: { spawnPty: SpawnPty },
): Promise<{ sql: string; ambiguities: string[] }> {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-pending-"));
  try {
    for (const entry of readdirSync(input.serverDir)) {
      const from = path.join(input.serverDir, entry);
      const to = path.join(dir, entry);
      if (entry === "drizzle" || entry === "drizzle.config.ts") {
        cpSync(from, to, { recursive: true });
      } else {
        symlinkSync(from, to);
      }
    }
    const { file, ambiguities } = await generate(
      dir,
      "pending",
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      deps.spawnPty,
    );
    return { sql: file === null ? "" : readFileSync(file, "utf8"), ambiguities };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** node-pty's `spawn`, required on first use (so callers whose deps are stubs never load it). */
export const nodePtySpawn: SpawnPty = (file, args, options) => {
  const pty = createRequire(import.meta.url)("node-pty") as { spawn: SpawnPty };
  return pty.spawn(file, args, options);
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [command, version] = process.argv.slice(2);
  try {
    const spawnPty = nodePtySpawn;
    if (command === "generate" && version !== undefined) {
      const result = await generateReleaseMigration(
        { version, serverDir: SERVER_DIR },
        { spawnPty },
      );
      for (const a of result.ambiguities) process.stderr.write(`ambiguous: ${a}\n`);
      if (result.file !== null) process.stdout.write(`${result.file}\n`);
    } else if (command === "pending" && version === undefined) {
      const result = await pendingSchemaReport({ serverDir: SERVER_DIR }, { spawnPty });
      for (const a of result.ambiguities) process.stderr.write(`ambiguous: ${a}\n`);
      process.stdout.write(result.sql);
    } else {
      process.stderr.write(
        "Usage: releaseMigration.ts generate <vX.Y.Z[-hotfix.N]> | releaseMigration.ts pending\n",
      );
      process.exitCode = 64;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "failed"}\n`);
    process.exitCode = 1;
  }
}
