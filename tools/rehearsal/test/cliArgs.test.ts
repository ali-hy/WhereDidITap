// F-195 composeArgs and the rehearsal CLI's arguments (A-449, A-452). TP-16.21. The CLI runs as a
// child process: rejected arguments exit 64 with the usage line before anything else; accepted
// ones get past the parser (run outside a git repository, so `git rev-parse` stops it there).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRun, type RunModule } from "./support/load.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "../src/cli.ts");
// The package's own tsx (a devDependency of @budmon/tools-rehearsal); the root doesn't declare one.
const TSX = path.join(HERE, "../node_modules/.bin/tsx");
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

    expect(r.error, String(r.error)).toBeUndefined();
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

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, r.stderr).toBe(64);
    expect(r.stderr).toContain(USAGE);
  });
});

describe("TP-16.21 (A-468): composeArgs with a doctor", () => {
  const r = "/h/releases/rehearsal";
  const doctor = {
    name: "x",
    project: "capture" as const,
    file: "/r/tools/rehearsal/test/doctored/x.capture.yaml",
    expectStep: "cross-role-secrets" as const,
  };

  it("TP-16.21 (A-468): main is unchanged", () => {
    expect(m.composeArgs({ releaseDir: r, opts: { doctor } }, "main")).toEqual(
      m.composeArgs({ releaseDir: r }, "main"),
    );
  });

  it("TP-16.21 (A-468): capture gets -f <file> right after its rehearsal overlay, before --env-file", () => {
    expect(m.composeArgs({ releaseDir: r, opts: { doctor } }, "capture")).toEqual([
      "compose",
      "--project-directory",
      r,
      "-p",
      "budmon-capture",
      "-f",
      `${r}/compose.capture.yaml`,
      "-f",
      `${r}/rehearsal/compose.rehearsal.capture.yaml`,
      "-f",
      "/r/tools/rehearsal/test/doctored/x.capture.yaml",
      "--env-file",
      `${r}/local.env`,
    ]);
  });
});

describe("TP-16.21 (A-468): the CLI's --doctor", () => {
  let repo: string;
  beforeAll(() => {
    // A temporary repository root (git rev-parse --show-toplevel) with its own doctored folder.
    repo = mkdtempSync(path.join(tmpdir(), "budmon-tp16-21-repo-"));
    spawnSync("git", ["init", "-q", repo]);
    const dir = path.join(repo, "tools/rehearsal/test/doctored");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "x.main.yaml"), "services: {}\n");
    writeFileSync(path.join(dir, "z.main.yaml"), "services: {}\n");
    writeFileSync(path.join(dir, "z.capture.yaml"), "services: {}\n");
    writeFileSync(path.join(dir, "w.main.yaml"), "services: {}\n");
    writeFileSync(path.join(dir, "expectations.json"), JSON.stringify({ x: "scan", z: "scan" }));
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** In `repo`; only cases the CLI refuses before the run starts. */
  const inRepo = (args: string[]) =>
    spawnSync(TSX, [CLI, "--previous", "none", "--version", "v1.0.0", ...args], {
      cwd: repo,
      encoding: "utf8",
      timeout: 60_000,
    });

  // Not run as a child process: an accepted --doctor goes on to start the real rehearsal (the
  // CLI has no fake exec), so the parsed value can only be checked through an exported parser.
  it.todo(
    "TP-16.21 (A-468): --doctor x (x.main.yaml, expectation scan) is accepted with doctor { name, project main, file, expectStep scan }",
  );

  it.each([
    ["y", "doctored overlay not found: y"],
    ["z", "doctored overlay ambiguous: z"],
    ["w", "doctored expectation missing: w"],
  ])("TP-16.21 (A-468): --doctor %s exits 64: %s", (name, message) => {
    const r = inRepo(["--doctor", name]);

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, r.stderr).toBe(64);
    expect(r.stderr).toContain(message);
  });

  it.each([[["--doctor", "A_b"]], [["--doctor", "x", "--doctor", "x"]]])(
    "TP-16.21 (A-468): %j exits 64 with the usage line",
    (args) => {
      const r = inRepo(args);

      expect(r.error, String(r.error)).toBeUndefined();
      expect(r.status, r.stderr).toBe(64);
      expect(r.stderr).toContain(USAGE);
    },
  );
});
