// The web dev server that `pnpm dev` starts (F-22 step 4, S-2 AC 1): Vite's dependency scan of
// apps/web must succeed, or every start logs "Failed to run dependency scan" and a cold first load
// fails with "504 (Outdated Optimize Dep)" (QA Q-F4). Vite 8's scanner re-parses any module that
// calls import.meta.glob as plain JS, so no .tsx file under apps/web/src may call it; the catalog
// globs live in i18n/catalogs.ts (A-502 (11)). TP-2.70: (a) runs only Vite's dev server, through
// its JS API, with a forced re-optimisation into a temporary cache directory
// (apps/web/node_modules/.vite isn't touched); (b) checks the rule statically.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = path.join(ROOT, "apps/web");
const SRC = path.join(WEB, "src");
const VITE_CACHE = path.join(WEB, "node_modules/.vite");

// Runs in a child Node process, so apps/web's own Vite and config load as `vite` would load them.
const PROBE = `
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const web = process.argv[1];
const vite = await import(pathToFileURL(createRequire(path.join(web, "package.json")).resolve("vite")).href);
const cacheDir = mkdtempSync(path.join(tmpdir(), "budmon-vite-scan-"));
console.log("probe: cache " + cacheDir);
try {
  const server = await vite.createServer({
    root: web,
    configFile: path.join(web, "vite.config.ts"),
    cacheDir,
    clearScreen: false,
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { force: true },
  });
  await server.listen();
  const optimizer = server.environments.client.depsOptimizer;
  console.log("probe: scan " + (optimizer?.scanProcessing ? "started" : "missing"));
  if (optimizer?.scanProcessing) await optimizer.scanProcessing;
  console.log("probe: scan settled");
  await server.close();
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
`;

/** Every path under `dir` with its mtime, or null when `dir` doesn't exist. */
function snapshot(dir: string): string[] | null {
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((p) => `${p} ${String(statSync(path.join(dir, p)).mtimeMs)}`);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith(".tsx"))
    .map((p) => path.join(dir, p));
}

describe("TP-2.70: the web dev server's dependency scan (F-22, F-206, S-2 AC 1)", () => {
  it("TP-2.70 (a): vite's dev server scans apps/web's dependencies without 'Failed to run dependency scan'; the temp cache is removed and node_modules/.vite untouched", () => {
    const before = snapshot(VITE_CACHE);

    const r = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE, WEB], {
      cwd: WEB,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      timeout: 120_000,
    });
    const output = `${r.stdout}${r.stderr}`;

    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.status, output).toBe(0);
    expect(output).toContain("probe: scan started");
    expect(output).toContain("probe: scan settled");
    expect(output).not.toContain("Failed to run dependency scan");
    expect(output).not.toContain("PARSE_ERROR");
    const cache = /^probe: cache (.+)$/m.exec(r.stdout)?.[1];
    expect(cache, output).toBeDefined();
    expect(existsSync(cache ?? "")).toBe(false);
    expect(snapshot(VITE_CACHE)).toEqual(before);
  }, 150_000);

  it("TP-2.70 (b): no .tsx file under apps/web/src calls import.meta.glob; i18n/catalogs.ts holds both catalog globs", () => {
    const offenders = tsxFiles(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("import.meta.glob"))
      .map((f) => path.relative(ROOT, f));

    expect(offenders).toEqual([]);
    const catalogs = readFileSync(path.join(SRC, "i18n/catalogs.ts"), "utf8");
    expect(catalogs).toMatch(/import\.meta\.glob(<[^>]*>)?\(\s*["']\.\/messages\/\*\.json["']/);
    expect(catalogs).toMatch(/import\.meta\.glob(<[^>]*>)?\(\s*["']\.\/generated\/\*\.json["']/);
  });
});
