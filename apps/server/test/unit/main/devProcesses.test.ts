// F-22 step 4, devProcesses (A-514): the commands `pnpm dev` starts. TP-2.72.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { devProcesses } from "../../../src/main/dev.js";
import { NodeBinMissingError } from "../../../src/platform/tooling/nodeBin.js";

const ROOT = path.resolve("repo");
const SERVER_DIR = path.join(ROOT, "apps", "server");
const WEB_DIR = path.join(ROOT, "apps", "web");
const WEB_MANIFEST = path.join(WEB_DIR, "package.json");
const EXEC_PATH = "/node";
const TSX = path.join("/bins", "tsx.js");
const VITE = path.join("/bins", "vite.js");
const WATCH = [
  "watch",
  "--tsconfig",
  "apps/server/tsconfig.json",
  "--import",
  "./apps/server/src/main/instrument.ts",
];

/** Deps with a recording `resolveBin` (returns `/bins/<name>.js`) and `exists` true only for `existing`. */
function fakeDeps(existing: readonly string[]) {
  const resolveBin = vi.fn((_dir: string, name: string): string =>
    path.join("/bins", `${name}.js`),
  );
  return {
    execPath: EXEC_PATH,
    resolveBin,
    exists: (p: string): boolean => existing.includes(p),
  };
}

describe("TP-2.72: devProcesses (F-22)", () => {
  it("TP-2.72 (a): with apps/web, returns api, worker and web as process.execPath on the bin scripts", () => {
    const env = Object.freeze({ A: "1" });
    const deps = fakeDeps([WEB_MANIFEST]);

    const processes = devProcesses(ROOT, env, deps);

    expect(processes).toEqual([
      {
        name: "api",
        command: EXEC_PATH,
        args: [TSX, ...WATCH, "apps/server/src/main/api.ts"],
        cwd: ROOT,
        env: { A: "1" },
      },
      {
        name: "worker",
        command: EXEC_PATH,
        args: [TSX, ...WATCH, "apps/server/src/main/worker.ts"],
        cwd: ROOT,
        env: { A: "1", WORKER_ROLES: "capture,general" },
      },
      { name: "web", command: EXEC_PATH, args: [VITE], cwd: WEB_DIR, env: { A: "1" } },
    ]);
    expect(deps.resolveBin.mock.calls).toContainEqual([SERVER_DIR, "tsx"]);
    expect(deps.resolveBin.mock.calls).toContainEqual([WEB_DIR, "vite"]);
    // No shim, no pnpm.
    for (const p of processes) {
      for (const part of [p.command, ...p.args]) {
        expect(part).not.toBe("pnpm");
        expect(part).not.toContain(".bin");
        expect(part.endsWith(".cmd")).toBe(false);
      }
    }
    // Each env is a new object; the argument is unchanged.
    for (const p of processes) expect(p.env).not.toBe(env);
    expect(env).toEqual({ A: "1" });
  });

  it("TP-2.72 (b): without apps/web/package.json, returns only api and worker and never resolves vite", () => {
    const deps = fakeDeps([]);

    const processes = devProcesses(ROOT, Object.freeze({ A: "1" }), deps);

    expect(processes.map((p) => p.name)).toEqual(["api", "worker"]);
    expect(deps.resolveBin.mock.calls.map(([, name]) => name)).not.toContain("vite");
  });

  it("TP-2.72 (c): resolveBin throwing NodeBinMissingError for vite propagates that error", () => {
    const failure = new NodeBinMissingError("vite", "not_installed");
    const deps = fakeDeps([WEB_MANIFEST]);
    deps.resolveBin.mockImplementation((_dir, name) => {
      if (name === "vite") throw failure;
      return path.join("/bins", `${name}.js`);
    });

    let caught: unknown;
    try {
      devProcesses(ROOT, Object.freeze({ A: "1" }), deps);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });
});
