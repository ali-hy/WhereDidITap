// A-478 the laptop-safety guard: checkRehearsalHost, checkNoLaptopStack, the CLI's refusal before
// any docker or sudo call, and the laptop names appearing only in guard.ts. TP-16.24.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGuard, type Exec, type ExecOptions, type GuardModule } from "./support/load.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "../src");
const NOT_CI = "not CI: set CI=true or pass --i-know-this-is-not-my-laptop";

let g: GuardModule;
beforeAll(async () => {
  g = await loadGuard();
});

describe("TP-16.24: checkRehearsalHost (A-478)", () => {
  const home = "/home/u";
  const host = (
    env: Record<string, string | undefined>,
    confirmNotLaptop: boolean,
    existing: string[] = [],
  ) =>
    g.checkRehearsalHost({
      env,
      homeDir: home,
      confirmNotLaptop,
      exists: (p) => existing.includes(p),
    });

  it.each([
    ["(a) CI unset, no flag", {}, false],
    ["(b) CI=1, no flag", { CI: "1" }, false],
  ])("TP-16.24 %s → not CI", (_label, env, flag) => {
    expect(host(env, flag)).toEqual({ ok: false, reason: NOT_CI });
  });

  it.each([
    ["(c) CI=true", { CI: "true" }, false],
    ["(d) CI unset, flag", {}, true],
  ])("TP-16.24 %s → ok", (_label, env, flag) => {
    expect(host(env, flag)).toEqual({ ok: true });
  });

  it.each([
    ["(e) CI=true", { CI: "true" }, false],
    ["(f) the flag", {}, true],
  ])(
    "TP-16.24 %s with ~/.budmon/state → an install exists (can't be overridden)",
    (_label, env, flag) => {
      expect(host(env, flag, [`${home}/.budmon/state`])).toEqual({
        ok: false,
        reason: "a Budmon install exists: ~/.budmon/state",
      });
    },
  );

  it("TP-16.24 (g) CI=true, BUDMON_HOME=/x with /x/state → an install exists: $BUDMON_HOME/state", () => {
    expect(host({ CI: "true", BUDMON_HOME: "/x" }, false, ["/x/state"])).toEqual({
      ok: false,
      reason: "a Budmon install exists: $BUDMON_HOME/state",
    });
  });
});

describe("TP-16.24: checkNoLaptopStack (A-478)", () => {
  function fakeExec(answer: (args: string[]) => { code: number; stdout: string }) {
    const calls: { cmd: string; args: string[]; o: ExecOptions }[] = [];
    const exec: Exec = (cmd, args, o) => {
      calls.push({ cmd, args, o });
      return Promise.resolve(answer(args));
    };
    return { exec, calls };
  }
  const empty = () => ({ code: 0, stdout: "" });

  it("TP-16.24: nothing present → ok, with exactly the three calls, tag guard", async () => {
    const { exec, calls } = fakeExec(empty);

    expect(await g.checkNoLaptopStack(exec)).toEqual({ ok: true });
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["docker", "ps", "-a", "-q", "--filter", "label=com.docker.compose.project=budmon-main"],
      ["docker", "ps", "-a", "-q", "--filter", "label=com.docker.compose.project=budmon-capture"],
      ["docker", "network", "ls", "-q", "--filter", "name=^budmon_capture_db$"],
    ]);
    expect(calls.every((c) => c.o.step === "guard")).toBe(true);
  });

  it("TP-16.24: budmon-main has a container → laptop stack present: budmon-main", async () => {
    const { exec } = fakeExec((args) =>
      args.includes("label=com.docker.compose.project=budmon-main")
        ? { code: 0, stdout: "abc\n" }
        : empty(),
    );

    expect(await g.checkNoLaptopStack(exec)).toEqual({
      ok: false,
      reason: "laptop stack present: budmon-main",
    });
  });

  it("TP-16.24: the capture-db network exists → laptop stack present: budmon_capture_db", async () => {
    const { exec } = fakeExec((args) =>
      args[0] === "network" ? { code: 0, stdout: "n1\n" } : empty(),
    );

    expect(await g.checkNoLaptopStack(exec)).toEqual({
      ok: false,
      reason: "laptop stack present: budmon_capture_db",
    });
  });

  it("TP-16.24: docker ps exiting 1 → docker unavailable", async () => {
    const { exec } = fakeExec((args) => (args[0] === "ps" ? { code: 1, stdout: "" } : empty()));

    expect(await g.checkNoLaptopStack(exec)).toEqual({ ok: false, reason: "docker unavailable" });
  });
});

describe("TP-16.24: the CLI refuses before any docker or sudo call (A-478)", () => {
  let base: string;
  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "budmon-tp16-24-"));
    const bin = path.join(base, "bin");
    mkdirSync(bin);
    for (const name of ["docker", "sudo"]) {
      const file = path.join(bin, name);
      writeFileSync(
        file,
        `#!/bin/sh\necho "${name} $*" >> "${path.join(base, "calls")}"\nexit 0\n`,
      );
      chmodSync(file, 0o755);
    }
    mkdirSync(path.join(base, "home"));
    mkdirSync(path.join(base, "tmp"));
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("TP-16.24: CI unset and no flag: exit 2, refusing to run: not CI, no docker or sudo call, no work directory", () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "CI" && k !== "BUDMON_HOME") env[k] = v;
    }
    env["PATH"] = `${path.join(base, "bin")}:${process.env["PATH"] ?? ""}`;
    env["HOME"] = path.join(base, "home");
    env["TMPDIR"] = path.join(base, "tmp");

    const r = spawnSync(
      path.join(HERE, "../node_modules/.bin/tsx"),
      [path.join(SRC, "cli.ts"), "--previous", "none", "--version", "v1.0.0"],
      { encoding: "utf8", env, cwd: base, timeout: 60_000 },
    );

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(`refusing to run: ${NOT_CI}`);
    let calls = "";
    try {
      calls = readFileSync(path.join(base, "calls"), "utf8");
    } catch {
      calls = "";
    }
    expect(calls).toBe("");
    const tmpEntries = readdirSync(path.join(base, "tmp")).filter((n) =>
      n.startsWith("budmon-rehearsal-"),
    );
    expect(tmpEntries).toEqual([]);
  });
});

describe("TP-16.24: the laptop names appear only in guard.ts (A-478)", () => {
  it("TP-16.24: no file under tools/rehearsal/src but guard.ts contains budmon-main, budmon-capture or budmon_capture_db", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name !== "guard.ts") {
          const text = readFileSync(p, "utf8");
          for (const literal of ["budmon-main", "budmon-capture", "budmon_capture_db"]) {
            // budmon-rehearsal-main etc. don't contain the literals, so a plain search is exact.
            if (text.includes(literal)) offenders.push(`${path.relative(SRC, p)}: ${literal}`);
          }
        }
      }
    };
    walk(SRC);

    expect(offenders).toEqual([]);
  });
});
