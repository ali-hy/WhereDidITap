// F-195 composeArgs and the CLI's argument parsing (A-449, A-452, A-468, A-478, A-479). TP-16.21.
// parseArgs and resolveDoctor are called directly from src/args.ts (A-479); no child process.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadArgs, loadRun, type ArgsModule, type RunModule } from "./support/load.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = "/h/releases/rehearsal";
const USAGE =
  "usage: rehearse --previous <tag|none> --version <vX.Y.Z[-hotfix.N]> [--doctor <name>] [--i-know-this-is-not-my-laptop]";

let m: RunModule;
let a: ArgsModule;
beforeAll(async () => {
  m = await loadRun();
  a = await loadArgs();
});

describe("TP-16.21: composeArgs (A-449, A-478)", () => {
  it.each(["main", "capture"] as const)(
    "TP-16.21: composeArgs(ctx, %s) uses -p budmon-rehearsal-%s",
    (p) => {
      expect(m.composeArgs({ releaseDir: R }, p)).toEqual([
        "compose",
        "--project-directory",
        R,
        "-p",
        `budmon-rehearsal-${p}`,
        "-f",
        `${R}/compose.${p}.yaml`,
        "-f",
        `${R}/rehearsal/compose.rehearsal.${p}.yaml`,
        "--env-file",
        `${R}/local.env`,
      ]);
    },
  );
});

describe("TP-16.21 (A-468): composeArgs with a doctor", () => {
  const doctor = {
    name: "x",
    project: "capture" as const,
    file: "/r/tools/rehearsal/test/doctored/x.capture.yaml",
    expectStep: "cross-role-secrets" as const,
  };

  it("TP-16.21 (A-468): main is unchanged", () => {
    expect(m.composeArgs({ releaseDir: R, opts: { doctor } }, "main")).toEqual(
      m.composeArgs({ releaseDir: R }, "main"),
    );
  });

  it("TP-16.21 (A-468): capture gets -f <file> right after its rehearsal overlay, before --env-file", () => {
    expect(m.composeArgs({ releaseDir: R, opts: { doctor } }, "capture")).toEqual([
      "compose",
      "--project-directory",
      R,
      "-p",
      "budmon-rehearsal-capture",
      "-f",
      `${R}/compose.capture.yaml`,
      "-f",
      `${R}/rehearsal/compose.rehearsal.capture.yaml`,
      "-f",
      "/r/tools/rehearsal/test/doctored/x.capture.yaml",
      "--env-file",
      `${R}/local.env`,
    ]);
  });
});

describe("TP-16.21 (A-479): parseArgs", () => {
  it("TP-16.21: --previous none --version v1.0.0", () => {
    expect(a.parseArgs(["--previous", "none", "--version", "v1.0.0"])).toEqual({
      ok: true,
      args: { previousTag: null, version: "v1.0.0", doctor: null, confirmNotLaptop: false },
    });
  });

  it("TP-16.21: --version v1.2.0 --previous v1.1.0", () => {
    expect(a.parseArgs(["--version", "v1.2.0", "--previous", "v1.1.0"])).toEqual({
      ok: true,
      args: { previousTag: "v1.1.0", version: "v1.2.0", doctor: null, confirmNotLaptop: false },
    });
  });

  it.each([
    [["--previous", "none"]],
    [["--previous", "none", "--version", "1.0.0"]],
    [["--previous", "none", "--version", "v1.0.0", "--version", "v1.0.1"]],
    [["--previous", "main", "--version", "v1.0.0"]],
    [["--previous", "none", "--version", "v1.0.0", "--doctor", "A_b"]],
    [["--previous", "none", "--version", "v1.0.0", "--doctor", "x", "--doctor", "x"]],
  ])("TP-16.21: %j → { ok: false }", (argv) => {
    expect(a.parseArgs(argv)).toEqual({ ok: false });
  });

  it("TP-16.21 (A-468): --doctor x is parsed as doctor x", () => {
    expect(a.parseArgs(["--previous", "none", "--version", "v1.0.0", "--doctor", "x"])).toEqual({
      ok: true,
      args: { previousTag: null, version: "v1.0.0", doctor: "x", confirmNotLaptop: false },
    });
  });

  it("TP-16.21 (A-478): --i-know-this-is-not-my-laptop sets confirmNotLaptop", () => {
    expect(
      a.parseArgs(["--previous", "none", "--version", "v1.0.0", "--i-know-this-is-not-my-laptop"]),
    ).toEqual({
      ok: true,
      args: { previousTag: null, version: "v1.0.0", doctor: null, confirmNotLaptop: true },
    });
  });

  it.each([
    [["--i-know-this-is-not-my-laptop", "--i-know-this-is-not-my-laptop"]],
    [["--i-know-this-is-not-my-laptop", "yes"]],
  ])("TP-16.21 (A-478): the flag %j → { ok: false }", (extra) => {
    expect(a.parseArgs(["--previous", "none", "--version", "v1.0.0", ...extra])).toEqual({
      ok: false,
    });
  });

  it("TP-16.21 (A-479): USAGE is F-195's string", () => {
    expect(a.USAGE).toBe(USAGE);
  });

  it("TP-16.21 (A-479): importing args.ts writes nothing and doesn't exit", () => {
    const script = `import(${JSON.stringify(path.join(HERE, "../src/args.ts"))}).then(() => process.stdout.write("IMPORTED"))`;
    const r = spawnSync(path.join(HERE, "../node_modules/.bin/tsx"), ["--eval", script], {
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("IMPORTED");
    expect(r.stderr).toBe("");
  });
});

describe("TP-16.21 (A-468, A-479): resolveDoctor", () => {
  let repo: string;
  const dir = () => path.join(repo, "tools/rehearsal/test/doctored");
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "budmon-tp16-21-repo-"));
    mkdirSync(dir(), { recursive: true });
    for (const f of ["x.main.yaml", "z.main.yaml", "z.capture.yaml", "w.main.yaml"]) {
      writeFileSync(path.join(dir(), f), "services: {}\n");
    }
    writeFileSync(path.join(dir(), "expectations.json"), JSON.stringify({ x: "scan", z: "scan" }));
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("TP-16.21: x → main, its absolute file, expectStep scan", () => {
    expect(a.resolveDoctor(repo, "x")).toEqual({
      ok: true,
      doctor: {
        name: "x",
        project: "main",
        file: path.join(repo, "tools/rehearsal/test/doctored/x.main.yaml"),
        expectStep: "scan",
      },
    });
  });

  it.each([
    ["y", "doctored overlay not found: y"],
    ["z", "doctored overlay ambiguous: z"],
    ["w", "doctored expectation missing: w"],
  ])("TP-16.21: %s → { ok: false, message: %j }", (name, message) => {
    expect(a.resolveDoctor(repo, name)).toEqual({ ok: false, message });
  });
});
