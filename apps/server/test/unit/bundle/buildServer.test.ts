// F-24 buildServer (A-43, A-56, A-62). TP-2.27, with S-6's cli and healthcheck.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../../scripts/build.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// A-147: F-89's telemetry preload is bundled too (dist/main/instrument.js).
// S-6 (A-56): cli (F-93) and healthcheck (F-175).
const ENTRY_NAMES = ["api", "worker", "migrate", "instrument", "cli", "healthcheck"];
// A-83: devMigrate is development-only too.
const DEVELOPMENT_ONLY = ["dev", "dbReset", "devMigrate"];

function dependencyKeys(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(SERVER_DIR, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {});
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Specifiers of static imports/exports, side-effect imports and literal dynamic imports. */
function importSpecifiers(code: string): string[] {
  const patterns = [
    /\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?["']([^"']+)["']/g,
    /\bexport\s*(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1] ?? ""));
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
}

describe("TP-2.27: buildServer", () => {
  let outdir = "";
  let result: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    outdir = mkdtempSync(path.join(tmpdir(), "budmon-build-"));
    result = await buildServer({ outdir });
  }, 120_000);

  afterAll(() => {
    rmSync(outdir, { recursive: true, force: true });
  });

  it("TP-2.27: writes api, worker and migrate with linked source maps, and no dev, dbReset or devMigrate", () => {
    const files = new Set(readdirSync(outdir));

    for (const name of ENTRY_NAMES) {
      expect(files).toContain(`${name}.js`);
      expect(files).toContain(`${name}.js.map`);
    }
    for (const name of DEVELOPMENT_ONLY) {
      expect(files).not.toContain(`${name}.js`);
    }
  });

  it("TP-2.27: no output imports a workspace package (@budmon/*) or a relative .ts file", () => {
    const problems: string[] = [];
    for (const file of jsFiles(outdir)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (
          specifier.startsWith("@budmon/") ||
          (specifier.startsWith(".") && specifier.endsWith(".ts"))
        ) {
          problems.push(`${path.relative(outdir, file)}: ${specifier}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("TP-2.27: every bare specifier left is a Node builtin (with or without node:) or a package in dependencies", () => {
    const allowed = new Set(dependencyKeys());
    const problems: string[] = [];
    for (const file of jsFiles(outdir)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
        if (specifier.startsWith("node:") || isBuiltin(specifier)) continue;
        if (!allowed.has(packageName(specifier))) {
          problems.push(`${path.relative(outdir, file)}: ${specifier}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("TP-2.27 (A-68): no output file contains drizzle-kit", () => {
    const offending = jsFiles(outdir).filter((file) =>
      readFileSync(file, "utf8").includes("drizzle-kit"),
    );

    expect(offending.map((file) => path.relative(outdir, file))).toEqual([]);
  });

  it("TP-2.27: external is the dependencies' names plus their /* forms", () => {
    const keys = dependencyKeys();

    expect([...result.external].sort()).toEqual([...keys, ...keys.map((k) => `${k}/*`)].sort());
  });

  it("TP-2.44x: the entry points are the S-2 main/ files except the development-only ones", () => {
    expect([...result.entryPoints].map((e) => e.replaceAll("\\", "/")).sort()).toEqual(
      ENTRY_NAMES.map((n) => `src/main/${n}.ts`).sort(),
    );
  });
});
