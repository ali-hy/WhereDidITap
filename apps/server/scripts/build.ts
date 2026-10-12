// F-24: bundles the server's process entry points with esbuild (A-43). Workspace packages are
// bundled from source; the server's own `dependencies` stay external.
import { readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const DEVELOPMENT_ONLY = new Set(["dev.ts", "dbReset.ts", "devMigrate.ts"]);

export async function buildServer(
  opts: { outdir?: string; serverDir?: string } = {},
): Promise<{ entryPoints: string[]; external: string[] }> {
  const serverDir =
    opts.serverDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outdir = opts.outdir ?? path.join(serverDir, "dist", "main");

  const pkg = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const names = Object.keys(pkg.dependencies ?? {});
  const external = [...names, ...names.map((name) => `${name}/*`)];

  const entryPoints = readdirSync(path.join(serverDir, "src", "main"))
    .filter((file) => file.endsWith(".ts") && !DEVELOPMENT_ONLY.has(file))
    .sort()
    .map((file) => `src/main/${file}`);

  rmSync(outdir, { recursive: true, force: true });
  await build({
    absWorkingDir: serverDir,
    entryPoints,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    splitting: true,
    outdir,
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: "linked",
    external,
    logLevel: "warning",
  });
  return { entryPoints, external };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    await buildServer();
  } catch (error) {
    process.stderr.write(
      `build failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
