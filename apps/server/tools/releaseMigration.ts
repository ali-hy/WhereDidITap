// F-180 generateReleaseMigration and F-181 pendingSchemaReport: drizzle-kit generate under a pty,
// answering its create-or-rename prompts with "create" and listing them as ambiguities.
//
// CLI (package scripts): `tsx tools/releaseMigration.ts generate <version>` prints the new file's
// path (or nothing when there are no changes); `tsx tools/releaseMigration.ts pending` prints the
// pending SQL. Both print the ambiguities on stderr.
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** A process running under a pseudo-terminal (A-377). */
export interface PtyProcess {
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number) => void): void;
  write(data: string): void;
  kill(): void;
}

/** Runs a shell command under a pseudo-terminal of the given size (injected). */
export type SpawnPty = (
  command: string,
  opts: { cwd: string; cols: number; rows: number },
) => PtyProcess;

/**
 * A-377: util-linux `script` gives the command a real pty, so drizzle-kit's prompts work with no
 * native module: `script -qfec "stty cols <c> rows <r>; <command>" /dev/null`.
 */
export const scriptPty: SpawnPty = (command, opts) => {
  const child = spawn(
    "script",
    ["-qfec", `stty cols ${String(opts.cols)} rows ${String(opts.rows)}; ${command}`, "/dev/null"],
    {
      cwd: opts.cwd,
      stdio: "pipe",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "xterm" },
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const dataListeners: ((chunk: string) => void)[] = [];
  const emit = (chunk: string) => {
    for (const cb of dataListeners) cb(chunk);
  };
  child.stdout.on("data", emit);
  child.stderr.on("data", emit);
  // A write after the child has gone must not crash the caller.
  child.stdin.on("error", () => undefined);
  // N-2: a spawn failure is reported through onExit (127), never thrown as an unhandled event.
  child.on("error", () => undefined);
  return {
    onData: (cb) => {
      dataListeners.push(cb);
    },
    onExit: (cb) => {
      let reported = false;
      const report = (code: number) => {
        if (reported) return;
        reported = true;
        cb(code);
      };
      child.on("close", (code, signal) => {
        report(code ?? (signal === null ? 1 : 128));
      });
      // N-2: `script` missing or not executable: the shell's "command not found" status.
      child.on("error", () => {
        report(127);
      });
    },
    write: (data) => {
      child.stdin.write(data);
    },
    kill: () => {
      child.kill("SIGTERM");
    },
  };
};

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

  // `name` is a validated version or "pending": no shell metacharacters.
  const pty = spawnPty(`pnpm exec drizzle-kit generate --name ${name}`, {
    cwd: dir,
    cols: 80,
    rows: 24,
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
    pty.onExit((code) => {
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
  deps: { spawnPty: SpawnPty } = { spawnPty: scriptPty },
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
  deps: { spawnPty: SpawnPty } = { spawnPty: scriptPty },
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [command, version] = process.argv.slice(2);
  try {
    const spawnPty = scriptPty;
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
