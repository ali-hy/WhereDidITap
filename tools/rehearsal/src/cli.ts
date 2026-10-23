// F-195's CLI: `pnpm --filter @budmon/tools-rehearsal rehearse --previous <tag|none> --version <v>`. It runs the
// rehearsal with the real child processes against the images tagged `rehearsal` (and the previous
// release's, tagged with its name), prints one line per record and exits 0 only when every record
// is ok. The work directory (artifacts in <workDir>/artifacts) is printed first.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRehearsal, type Exec } from "./run.js";

const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$/;

function usage(): never {
  process.stderr.write("usage: rehearse --previous <tag|none> --version <vX.Y.Z[-hotfix.N]>\n");
  process.exit(64);
}

const exec: Exec = (cmd, args, o) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: ["pipe", "pipe", "inherit"],
      ...(o.timeoutMs === undefined ? {} : { timeout: o.timeoutMs }),
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", () => {
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout });
    });
    child.stdin.end(o.input);
  });

/** A-452: exactly --previous and --version, each once, in either order. */
function parseArgs(argv: readonly string[]): { previous: string; version: string } {
  if (argv.length !== 4) usage();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    if ((flag !== "--previous" && flag !== "--version") || values.has(flag)) usage();
    values.set(flag, argv[i + 1] ?? "");
  }
  const previous = values.get("--previous") ?? "";
  const version = values.get("--version") ?? "";
  if ((previous !== "none" && !TAG.test(previous)) || !TAG.test(version)) usage();
  return { previous, version };
}

const { previous, version } = parseArgs(process.argv.slice(2));

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workDir = mkdtempSync(path.join(tmpdir(), "budmon-rehearsal-"));
process.stdout.write(`work dir: ${workDir}\n`);

const result = await runRehearsal(
  {
    previousTag: previous === "none" ? null : previous,
    version,
    images: {
      server: "budmon/server:rehearsal",
      web: "budmon/web:rehearsal",
      postgres: "budmon/postgres:rehearsal",
    },
    workDir,
    repoRoot,
  },
  { exec },
);
for (const step of result.steps) {
  process.stdout.write(
    `${step.ok ? "ok  " : "FAIL"} ${step.name}${step.detail === "" ? "" : `: ${step.detail}`}\n`,
  );
}
process.exitCode = result.ok ? 0 : 1;
