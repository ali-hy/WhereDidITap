// F-180 against the real drizzle-kit under scriptPty (A-377, util-linux script(1)), and F-181's pending report. TP-14.2, TP-14.3.
// The projects are throwaway copies of a tiny Drizzle project (not the server schema), so a rename
// prompt can be provoked deterministically.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import { readJournal } from "../../../src/platform/db/migrations.js";
import { generatePlain, loadReleaseMigration, loadScriptPty } from "../../support/s14.js";

const CONFIG = `import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./schema.ts", out: "./drizzle" });
`;
const schema = (column: string) => `import { integer, pgTable, text } from "drizzle-orm/pg-core";
export const things = pgTable("things", { id: integer("id").primaryKey(), ${column}: text("${column}") });
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project with one generated migration for column `note`, then the schema renamed to `memo`. */
function renamedProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-f180-real-"));
  dirs.push(dir);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, type: "module" }),
  );
  writeFileSync(path.join(dir, "drizzle.config.ts"), CONFIG);
  symlinkSync(path.join(SERVER_DIR, "node_modules"), path.join(dir, "node_modules"));
  mkdirSync(path.join(dir, "drizzle"));
  writeFileSync(path.join(dir, "schema.ts"), schema("note"));
  generatePlain(dir, "v0.1.0");
  writeFileSync(path.join(dir, "schema.ts"), schema("memo"));
  return dir;
}

describe("TP-14.2: generateReleaseMigration with the real drizzle-kit (F-180)", () => {
  it("TP-14.2: a renamed column lists one ambiguity, and the SQL creates (ADD COLUMN plus DROP COLUMN)", async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const dir = renamedProject();

    const result = await generateReleaseMigration(
      { version: "v0.2.0", serverDir: dir },
      { spawnPty: await loadScriptPty() },
    );

    expect(result.ambiguities).toHaveLength(1);
    expect(result.file).not.toBeNull();
    const sql = readFileSync(path.resolve(dir, result.file ?? ""), "utf8");
    expect(sql).toMatch(/ADD COLUMN "memo"/);
    expect(sql).toMatch(/DROP COLUMN "note"/);
    expect(path.basename(result.file ?? "")).toMatch(/^\d{4}_v0\.2\.0\.sql$/);
    // A-376: the version-named journal tags (the baseline 0000_v0.1.0 and this one) pass readJournal.
    expect(readJournal(path.join(dir, "drizzle")).map((e) => e.tag)).toEqual([
      "0000_v0.1.0",
      "0001_v0.2.0",
    ]);
  }, 180_000);
});

describe("TP-14.3: pendingSchemaReport doesn't touch the repository (F-181)", () => {
  it("TP-14.3: in a git repository the report returns the SQL and git status stays clean", async () => {
    const { pendingSchemaReport } = await loadReleaseMigration();
    const dir = renamedProject();
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.invalid",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.invalid",
        },
      });
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");

    // A-361, A-377: deps are { spawnPty } (the real scriptPty here), and input takes timeoutMs.
    const report = await pendingSchemaReport(
      { serverDir: dir, timeoutMs: 150_000 },
      { spawnPty: await loadScriptPty() },
    );

    expect(report.sql).toMatch(/ADD COLUMN "memo"/);
    expect(report.ambiguities).toHaveLength(1);
    expect(git("status", "--porcelain")).toBe("");
  }, 180_000);

  it("TP-14.11x: with no schema change the report is empty", async () => {
    const { pendingSchemaReport } = await loadReleaseMigration();
    const dir = renamedProject();
    writeFileSync(path.join(dir, "schema.ts"), schema("note"));

    const report = await pendingSchemaReport(
      { serverDir: dir },
      { spawnPty: await loadScriptPty() },
    );

    expect(report).toEqual({ sql: "", ambiguities: [] });
  }, 180_000);
});
