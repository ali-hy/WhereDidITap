// The web dev server that `pnpm dev` starts (F-22 step 4, S-2 AC 1): Vite's dependency scan of
// apps/web must succeed, or every start logs "Failed to run dependency scan" and a cold first load
// fails with "504 (Outdated Optimize Dep)" (QA Q-F4). TP-2.18x: TP-2.18 starts the whole stack in
// CI's dev-smoke job; this runs only Vite's dev server, through its JS API, with a forced
// re-optimisation into a temporary cache directory (apps/web/node_modules/.vite isn't touched).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = path.join(ROOT, "apps/web");

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
try {
  const server = await vite.createServer({
    root: web,
    configFile: path.join(web, "vite.config.ts"),
    cacheDir,
    clearScreen: false,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
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

describe("TP-2.18x: the web dev server's dependency scan (F-22, S-2 AC 1)", () => {
  it("TP-2.18x: vite's dev server scans apps/web's dependencies without 'Failed to run dependency scan'", () => {
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
  }, 150_000);
});
