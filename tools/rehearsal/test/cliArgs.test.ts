// F-195 composeArgs and the rehearsal CLI's arguments (A-449, A-452). TP-16.21. The CLI runs as a
// child process: rejected arguments exit 64 with the usage line before anything else; accepted
// ones get past the parser (run outside a git repository, so `git rev-parse` stops it there).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRun, type RunModule } from "./support/load.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "../src/cli.ts");
const TSX = path.join(HERE, "../../../node_modules/.bin/tsx");
const USAGE = "usage: rehearse --previous <tag|none> --version <vX.Y.Z[-hotfix.N]>";

let m: RunModule;
let outside: string;
beforeAll(async () => {
  m = await loadRun();
  outside = mkdtempSync(path.join(tmpdir(), "budmon-tp16-21-"));
});
afterAll(() => {
  rmSync(outside, { recursive: true, force: true });
});

const cli = (args: string[]) =>
  spawnSync(TSX, [CLI, ...args], {
    cwd: outside,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(outside) },
    timeout: 60_000,
  });

describe("TP-16.21: composeArgs (A-449)", () => {
  it.each(["main", "capture"] as const)("TP-16.21: composeArgs(ctx, %s)", (p) => {
    const r = "/h/releases/rehearsal";

    expect(m.composeArgs({ releaseDir: r }, p)).toEqual([
      "compose",
      "--project-directory",
      r,
      "-p",
      `budmon-${p}`,
      "-f",
      `${r}/compose.${p}.yaml`,
      "-f",
      `${r}/rehearsal/compose.rehearsal.${p}.yaml`,
      "--env-file",
      `${r}/local.env`,
    ]);
  });
});

describe("TP-16.21: the CLI's arguments (A-452)", () => {
  it.each([
    [["--previous", "none", "--version", "v1.0.0"]],
    [["--version", "v1.2.0", "--previous", "v1.1.0"]],
  ])("TP-16.21: %j is accepted (not exit 64, no usage line)", (args) => {
    const r = cli(args);

    expect(r.status, r.stderr).not.toBe(64);
    expect(r.stderr).not.toContain(USAGE);
  });

  it.each([
    [["--previous", "none"]],
    [["--previous", "none", "--version", "1.0.0"]],
    [["--previous", "none", "--version", "v1.0.0", "--version", "v1.0.1"]],
    [["--previous", "main", "--version", "v1.0.0"]],
  ])("TP-16.21: %j exits 64 with the usage line", (args) => {
    const r = cli(args);

    expect(r.status).toBe(64);
    expect(r.stderr).toContain(USAGE);
  });
});
