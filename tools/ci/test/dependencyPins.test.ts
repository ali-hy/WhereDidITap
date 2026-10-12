// TP-0.20: ESLint 10 dependency pins, the single declared peer exception and the ignored build
// script (A-13, A-19, A-32).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function configPackage(): PackageJson {
  return JSON.parse(
    readFileSync(path.join(ROOT, "packages/config/package.json"), "utf8"),
  ) as PackageJson;
}

/** Every version range declared for `name` in packages/config/package.json. */
function declaredVersions(name: string): string[] {
  const pkg = configPackage();
  return [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]
    .map((deps) => deps?.[name])
    .filter((version): version is string => version !== undefined);
}

// TP-0.20 (b) and (c) clone HEAD: they test the committed tree, so uncommitted changes in this
// checkout (package.json, pnpm-workspace.yaml, the lockfile) don't affect them until committed.
/** Clones HEAD (the committed tree, no node_modules) into a temporary directory, runs `pnpm install <args>` there and
 * returns the exit status and combined output. */
function installInCleanClone(args: readonly string[]): { status: number | null; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-install-"));
  try {
    const checkout = path.join(dir, "budmon");
    const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", ROOT, checkout], {
      encoding: "utf8",
    });
    if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr}`);
    const install = spawnSync("pnpm", ["install", ...args], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    return { status: install.status, output: `${install.stdout}${install.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TP-0.20: ESLint 10 dependency pins (A-13)", () => {
  it("TP-0.20 (a): peerDependencyRules has exactly allowedVersions { eslint-plugin-jsx-a11y>eslint: 10 }", () => {
    const workspace = parse(readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
      peerDependencyRules?: unknown;
    };

    expect(workspace.peerDependencyRules).toEqual({
      allowedVersions: { "eslint-plugin-jsx-a11y>eslint": "10" },
    });
  });

  it("TP-0.20 (a): ignoredBuiltDependencies is exactly [cpu-features, esbuild, protobufjs, ssh2] and there's no onlyBuiltDependencies (A-32, A-65)", () => {
    const workspace = parse(readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
      ignoredBuiltDependencies?: unknown;
      onlyBuiltDependencies?: unknown;
    };

    expect(workspace.ignoredBuiltDependencies).toEqual([
      "cpu-features",
      "esbuild",
      "protobufjs",
      "ssh2",
    ]);
    expect(workspace).not.toHaveProperty("onlyBuiltDependencies");
  });

  it("TP-0.20 (a): the root package.json has no pnpm field (A-65)", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as object;

    expect(pkg).not.toHaveProperty("pnpm");
  });

  it.each([
    ["eslint-plugin-formatjs", "8.1.1"],
    ["eslint-plugin-jsx-a11y", "6.10.2"],
    ["eslint", "10.12.0"],
  ])("TP-0.20 (a): packages/config pins %s to exactly %s", (name, version) => {
    const versions = declaredVersions(name);

    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v === version)).toBe(true);
  });

  it("TP-0.20 (b): a resolving install (pnpm install --fix-lockfile) in a fresh clone exits 0 and reports no peer issue", () => {
    const { status, output } = installInCleanClone(["--fix-lockfile"]);

    expect(status, output).toBe(0);
    expect(output).not.toContain("Issues with peer dependencies found");
    expect(output).not.toContain("unmet peer");
  }, 300_000);

  it("TP-0.20 (c): pnpm install --frozen-lockfile in a fresh clone exits 0 without an ignored-build-scripts notice", () => {
    const { status, output } = installInCleanClone(["--frozen-lockfile"]);

    expect(status, output).toBe(0);
    expect(output).not.toContain("Ignored build scripts");
  }, 300_000);
});

// TP-0.28 (A-314): solid-js moves in lockstep with babel-preset-solid, read from the lockfile
// without an install.
describe("TP-0.28: the Solid lockstep (§2.4, A-314)", () => {
  function lockPackages(): string[] {
    const lock = parse(readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8")) as {
      packages?: Record<string, unknown>;
      snapshots?: Record<string, unknown>;
    };
    return [...Object.keys(lock.packages ?? {}), ...Object.keys(lock.snapshots ?? {})];
  }

  /** Every resolved version of `name` in the lockfile (peer suffixes stripped). */
  function resolved(name: string): string[] {
    const prefix = `${name}@`;
    return [
      ...new Set(
        lockPackages()
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length).split("(")[0] ?? ""),
      ),
    ].sort();
  }

  function webSolid(): string | undefined {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8"),
    ) as PackageJson;
    return pkg.dependencies?.["solid-js"];
  }

  it("TP-0.28: apps/web's solid-js is an exact version", () => {
    expect(webSolid()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("TP-0.28: every babel-preset-solid in the lockfile has solid-js's version", () => {
    const presets = resolved("babel-preset-solid");

    expect(presets.length).toBeGreaterThan(0);
    expect(presets).toEqual([webSolid()]);
  });

  it("TP-0.28: solid-js resolves to exactly one version, apps/web's", () => {
    expect(resolved("solid-js")).toEqual([webSolid()]);
  });
});
