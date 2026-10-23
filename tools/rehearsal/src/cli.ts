// F-195's CLI: `pnpm --filter @budmon/tools-rehearsal rehearse --previous <tag|none>`. It runs the
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
  process.stderr.write("usage: rehearse --previous <tag|none>\n");
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

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--previous") usage();
const previous = args[1] ?? "";
if (previous !== "none" && !TAG.test(previous)) usage();

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workDir = mkdtempSync(path.join(tmpdir(), "budmon-rehearsal-"));
process.stdout.write(`work dir: ${workDir}\n`);

const result = await runRehearsal(
  {
    previousTag: previous === "none" ? null : previous,
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
