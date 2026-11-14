// F-22b resolveNodeBin and NodeBinMissingError (A-514), with F-26's failure line. TP-2.71.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { failureLine } from "../../../src/platform/observability/describeFailure.js";
import { NodeBinMissingError, resolveNodeBin } from "../../../src/platform/tooling/nodeBin.js";

const FROM = path.resolve("from");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** `<pkgDir>` for a package name, as the fake `resolve` places it. */
function pkgDir(name: string): string {
  return path.resolve("fake", name);
}

/**
 * Fake deps: `resolve` maps `<name>/package.json` to `<pkgDir>/package.json` and records its
 * arguments; `readFile` returns `manifest` (an object is serialised, a string is returned as is).
 */
function fakeDeps(manifest: unknown) {
  const resolve = vi.fn((_fromDir: string, request: string): string => {
    const name = request.slice(0, -"/package.json".length);
    return path.join(pkgDir(name), "package.json");
  });
  const readFile = vi.fn<(file: string) => string>(() =>
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
  return { resolve, readFile };
}

/** Runs `fn` and returns what it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("TP-2.71: resolveNodeBin (F-22b)", () => {
  it("TP-2.71 (a): a string bin (tsx) resolves tsx/package.json once and returns the script beside it", () => {
    const deps = fakeDeps({ name: "tsx", bin: "./dist/cli.mjs" });

    const result = resolveNodeBin(FROM, "tsx", undefined, deps);

    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledWith(FROM, "tsx/package.json");
    expect(deps.readFile).toHaveBeenCalledWith(path.join(pkgDir("tsx"), "package.json"));
    expect(result).toBe(path.resolve(pkgDir("tsx"), "dist/cli.mjs"));
  });

  it("TP-2.71 (b): an object bin (vite) returns bin.vite", () => {
    const deps = fakeDeps({ name: "vite", bin: { vite: "bin/vite.js" } });

    const result = resolveNodeBin(FROM, "vite", undefined, deps);

    expect(deps.resolve).toHaveBeenCalledWith(FROM, "vite/package.json");
    expect(result).toBe(path.resolve(pkgDir("vite"), "bin/vite.js"));
  });

  it("TP-2.71 (c): a scoped package's string bin is used for its unscoped name", () => {
    const deps = fakeDeps({ name: "@scope/tool", bin: "cli.js" });

    const result = resolveNodeBin(FROM, "@scope/tool", undefined, deps);

    expect(deps.resolve).toHaveBeenCalledWith(FROM, "@scope/tool/package.json");
    expect(result).toBe(path.resolve(pkgDir("@scope/tool"), "cli.js"));
  });

  it("TP-2.71 (d): an explicit binName picks that key of an object bin", () => {
    const deps = fakeDeps({ name: "tool", bin: { tool: "a.js", other: "b.js" } });

    const result = resolveNodeBin(FROM, "tool", "other", deps);

    expect(result).toBe(path.resolve(pkgDir("tool"), "b.js"));
  });

  it("TP-2.71 (e): an explicit binName other than the package's own name, with a string bin, throws NodeBinMissingError no_bin", () => {
    const deps = fakeDeps({ name: "tool", bin: "a.js" });

    const error = thrown(() => resolveNodeBin(FROM, "tool", "other", deps));

    expect(error).toBeInstanceOf(NodeBinMissingError);
    expect(error).toMatchObject({
      name: "NodeBinMissingError",
      packageName: "tool",
      reason: "no_bin",
      message: "tool has no other bin",
    });
  });

  it("TP-2.71 (f): resolve throwing MODULE_NOT_FOUND throws NodeBinMissingError not_installed and never reads a file", () => {
    const deps = fakeDeps({});
    deps.resolve.mockImplementation(() => {
      throw Object.assign(new Error("Cannot find module 'tsx/package.json'"), {
        code: "MODULE_NOT_FOUND",
      });
    });

    const error = thrown(() => resolveNodeBin(FROM, "tsx", undefined, deps));

    expect(error).toBeInstanceOf(NodeBinMissingError);
    expect(error).toMatchObject({
      name: "NodeBinMissingError",
      packageName: "tsx",
      reason: "not_installed",
      message: "tsx isn't installed; run pnpm install",
    });
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it.each([
    ["no bin", { name: "tool" }],
    ["bin {}", { name: "tool", bin: {} }],
    ['bin { tool: "" }', { name: "tool", bin: { tool: "" } }],
    ["a manifest that isn't JSON", "{"],
  ])("TP-2.71 (g): %s throws NodeBinMissingError no_bin", (_label, manifest) => {
    const deps = fakeDeps(manifest);

    const error = thrown(() => resolveNodeBin(FROM, "tool", undefined, deps));

    expect(error).toBeInstanceOf(NodeBinMissingError);
    expect(error).toMatchObject({ packageName: "tool", reason: "no_bin" });
  });

  it("TP-2.71x: a readFile that throws ENOENT throws NodeBinMissingError no_bin", () => {
    const deps = fakeDeps({});
    deps.readFile.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    });

    const error = thrown(() => resolveNodeBin(FROM, "tool", undefined, deps));

    expect(error).toBeInstanceOf(NodeBinMissingError);
    expect(error).toMatchObject({
      packageName: "tool",
      reason: "no_bin",
      message: "tool has no tool bin",
    });
  });

  it("TP-2.71 (h): with the default deps, tsx from apps/server and vite from apps/web resolve to their installed bin scripts", () => {
    const tsx = resolveNodeBin(path.join(REPO, "apps", "server"), "tsx");
    const vite = resolveNodeBin(path.join(REPO, "apps", "web"), "vite");

    expect(path.isAbsolute(tsx)).toBe(true);
    expect(existsSync(tsx)).toBe(true);
    expect(tsx.endsWith(path.join("dist", "cli.mjs"))).toBe(true);
    expect(path.isAbsolute(vite)).toBe(true);
    expect(existsSync(vite)).toBe(true);
    expect(vite.endsWith(path.join("bin", "vite.js"))).toBe(true);
  });
});

describe("TP-2.71 (i): F-26 reports NodeBinMissingError's reason", () => {
  it("TP-2.71 (i): failureLine gives pnpm dev failed: NodeBinMissingError (not_installed)", () => {
    expect(failureLine("pnpm dev", new NodeBinMissingError("tsx", "not_installed"))).toBe(
      "pnpm dev failed: NodeBinMissingError (not_installed)",
    );
  });
});
