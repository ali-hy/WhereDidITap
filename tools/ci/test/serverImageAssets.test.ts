// TP-0.35's static part (identity LLD PA-14, LD-5, S-1): the server image carries every module's
// assets at src/<module>/assets/, where loadCommonPasswords() looks (join(serverRoot(), "src", …)).
// The image itself is checked by S-1's acceptance criterion 4 and the rehearsal's 7b (TP-1.36).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCKERFILE = path.join(ROOT, "images/server/Dockerfile");

/** The Dockerfile's stages: each FROM line and the instructions after it, continuations joined. */
function stages(): { from: string; lines: string[] }[] {
  const joined = readFileSync(DOCKERFILE, "utf8").replace(/\\\r?\n/g, " ");
  const out: { from: string; lines: string[] }[] = [];
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^FROM\s/i.test(line)) out.push({ from: line, lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out;
}

/** Modules with an assets directory under apps/server/src. */
function modulesWithAssets(): string[] {
  const src = path.join(ROOT, "apps/server/src");
  return readdirSync(src, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(src, e.name, "assets")))
    .map((e) => e.name);
}

describe("TP-0.35 (S): images/server/Dockerfile copies the modules' assets", () => {
  it("TP-0.35: identity has an assets directory with the common-password list", () => {
    expect(modulesWithAssets()).toContain("identity");
    expect(existsSync(path.join(ROOT, "apps/server/src/identity/assets/common-100k.txt.gz"))).toBe(
      true,
    );
  });

  it("TP-0.35: the build stage copies apps/server's src/*/assets (every module, by glob) into /out/src/<module>/assets, keeping the relative paths", () => {
    const [build] = stages();
    const commands = (build?.lines ?? [])
      .filter((l) => /^RUN\s/i.test(l))
      .flatMap((l) => l.replace(/^RUN\s+/i, "").split(/\s*&&\s*/));

    const assetCopies = commands.filter((c) => c.includes("src/*/assets"));
    expect(assetCopies.length, "a build-stage command names src/*/assets").toBeGreaterThan(0);
    // Same relative paths: cp --parents (or an equivalent that keeps src/<module>/) into /out.
    expect(
      assetCopies.some(
        (c) => /\bcp\b.*--parents\b.*\s\/out\/?(\s|$)/.test(c) || /\s\/out\/src\b/.test(c),
      ),
      assetCopies.join("\n"),
    ).toBe(true);
  });

  it("TP-0.35: the runtime stage copies /out/ to /app/, so the assets land at /app/src/<module>/assets", () => {
    const runtime = stages().at(-1);

    expect(runtime?.lines).toContain("COPY --from=build /out/ /app/");
    expect(runtime?.lines).toContain("WORKDIR /app");
  });
});
