// A-476 createLoggingExec: each child's output goes to <logDir>/<tag>.log, never to the job log;
// arguments, env and input are never written. TP-16.25.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExec, type Exec } from "./support/load.js";

let logDir: string;
let base: string;
let exec: Exec;
let written: string[];

beforeEach(async () => {
  base = mkdtempSync(path.join(tmpdir(), "budmon-tp16-25-"));
  logDir = path.join(base, "steps");
  exec = (await loadExec()).createLoggingExec(logDir);
  written = [];
  // Anything the exec itself writes to the test process's stdout or stderr is caught here.
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

describe("TP-16.25: createLoggingExec (A-476)", () => {
  it("TP-16.25: a/b: returns code and stdout; a--b.log has the headers, stdout, stderr and exit, and no argument, env or input", async () => {
    const r = await exec("sh", ["-c", "echo out; echo err >&2; exit 3", "SECRETARG"], {
      step: "a/b",
      env: { X: "SECRETENV" },
      input: "SECRETIN",
    });
    const captured = [...written];
    vi.restoreAllMocks();

    expect(r).toEqual({ code: 3, stdout: "out\n" });
    const file = path.join(logDir, "a--b.log");
    const log = readFileSync(file, "utf8");
    expect(log).toContain("### sh (step a/b)");
    expect(log).toContain("out");
    expect(log).toContain("--- stderr");
    expect(log).toContain("err");
    expect(log).toContain("### exit 3");
    for (const secret of ["SECRETARG", "SECRETENV", "SECRETIN"]) expect(log).not.toContain(secret);
    expect(mode(file)).toBe("600");
    expect(mode(logDir)).toBe("700");
    expect(captured.join("")).toBe("");
  });

  it("TP-16.25: c with sensitiveStdout: the log withholds stdout but keeps stderr; the caller still gets stdout", async () => {
    const r = await exec("sh", ["-c", "echo out; echo err >&2; exit 3"], {
      step: "c",
      sensitiveStdout: true,
    });
    const captured = [...written];
    vi.restoreAllMocks();

    expect(r.stdout).toBe("out\n");
    const log = readFileSync(path.join(logDir, "c.log"), "utf8");
    expect(log).toContain("[stdout withheld]");
    expect(log).toContain("err");
    expect(log).not.toMatch(/^out$/m);
    expect(captured.join("")).toBe("");
  });

  it("TP-16.25: d, a command that doesn't exist: code 127, nothing written to the process", async () => {
    const r = await exec("/no/such/cmd", [], { step: "d" });
    const captured = [...written];
    vi.restoreAllMocks();

    expect(r.code).toBe(127);
    expect(captured.join("")).toBe("");
  });
});
