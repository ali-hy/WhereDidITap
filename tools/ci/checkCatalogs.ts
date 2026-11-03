// F-9: every message ID the web app uses is in every shipped catalog (D-37).
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "@formatjs/cli-lib";

/** For each shipped locale, the used IDs it lacks, sorted; `[]` when complete (A-312). */
export function checkCatalogs(input: {
  usedIds: ReadonlySet<string>;
  catalogs: Record<string, Record<string, string>>;
}): { missing: Record<string, string[]> } {
  const missing: Record<string, string[]> = {};
  for (const [locale, catalog] of Object.entries(input.catalogs)) {
    missing[locale] = [...input.usedIds].filter((id) => !Object.hasOwn(catalog, id)).sort();
  }
  return { missing };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Shipped catalogs; pseudo-locales are generated, not shipped (F-207). */
const SHIPPED_LOCALES = ["en"];
const EXIT_USAGE = 64;
const USAGE = "Usage: checkCatalogs [--root <dir>]  (default: the repository root)";

/** The IDs used in `apps/web/src/**\/*.{ts,tsx}`, as F-1's formatjs settings see them (A-12). */
export async function usedMessageIds(root: string = ROOT): Promise<Set<string>> {
  // A-332: fixtures stay out of the catalogs.
  const files = globSync("apps/web/src/**/*.{ts,tsx}", { cwd: root })
    .filter((f) => !f.replaceAll("\\", "/").startsWith("apps/web/src/fixtures/"))
    .map((f) => path.join(root, f));
  if (files.length === 0) return new Set();
  const extracted = JSON.parse(
    await extract(files, { additionalFunctionNames: ["t"], throws: true }),
  ) as Record<string, unknown>;
  return new Set(Object.keys(extracted));
}

/**
 * A-323: `[--root <dir>]` (relative to INIT_CWD, else the working directory). Exit 0 silently;
 * 1 with `missing <locale>: <id>` lines on stderr; 64 with usage for bad arguments or a root
 * without apps/web/src.
 */
export async function runCheckCatalogsCli(
  argv: readonly string[],
  io: { stderr: (line: string) => void; cwd: string },
): Promise<number> {
  let root = ROOT;
  if (argv.length > 0) {
    const [flag, value, ...rest] = argv;
    if (flag !== "--root" || value === undefined || value === "" || rest.length > 0) {
      io.stderr(USAGE);
      return EXIT_USAGE;
    }
    root = path.resolve(io.cwd, value);
  }
  if (!existsSync(path.join(root, "apps/web/src"))) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const catalogs = Object.fromEntries(
    SHIPPED_LOCALES.map((locale) => {
      const file = path.join(root, "apps/web/src/i18n/messages", `${locale}.json`);
      const catalog = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>)
        : {};
      return [locale, catalog];
    }),
  );
  const { missing } = checkCatalogs({ usedIds: await usedMessageIds(root), catalogs });
  let failed = false;
  for (const [locale, ids] of Object.entries(missing)) {
    for (const id of ids) {
      io.stderr(`missing ${locale}: ${id}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runCheckCatalogsCli(process.argv.slice(2), {
    stderr: (line) => process.stderr.write(`${line}\n`),
    cwd: process.env["INIT_CWD"] ?? process.cwd(),
  });
}
