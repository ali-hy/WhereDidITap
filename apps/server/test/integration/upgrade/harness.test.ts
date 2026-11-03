// F-183 the upgrade harness at the baseline. TP-14.7.
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import { generateBaseline, serverFixture } from "../../support/s14.js";
import { previousReleaseTag, runUpgradeHarness } from "../../upgrade/harness.js";

const repos: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

function repo(tags: readonly string[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-upgrade-"));
  repos.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.invalid",
      },
    });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "a.txt"), "a");
  git("add", "a.txt");
  git("commit", "-q", "-m", "a");
  for (const t of tags) git("tag", t);
  return dir;
}

describe("TP-14.7: the upgrade harness at the baseline (F-183)", () => {
  it('TP-14.7: with no previous tag the harness reports "skipped: baseline" and passes', async () => {
    expect(await runUpgradeHarness({ repoDir: repo(), version: "v0.1.0" })).toEqual({
      status: "skipped: baseline",
    });
  });

  it('TP-14.7: the CLI prints "skipped: baseline" and exits 0', () => {
    const dir = repo();
    const result = spawnSync(
      path.join(SERVER_DIR, "node_modules/.bin/tsx"),
      [path.join(SERVER_DIR, "test/upgrade/harness.ts"), "--repo", dir, "--version", "v0.1.0"],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("skipped: baseline");
  }, 60_000);

  it("TP-14.11x: the previous tag is the latest v[0-9]* tag reachable from HEAD, release or hotfix", () => {
    expect(previousReleaseTag(repo(["v1.2.0"]))).toBe("v1.2.0");
    expect(previousReleaseTag(repo(["not-a-release"]))).toBeNull();
    expect(previousReleaseTag(repo(["vX"]))).toBeNull();
  });

  // A-368: a tag but no test/upgrade/<vN>/ folder migrates the previous schema to HEAD and passes.
  it("TP-14.7 (A-368): with a tag and no test/upgrade/<vN>/ folder, the previous schema is migrated to HEAD and the harness passes", async () => {
    const dir = releasedRepo();

    const result = await runUpgradeHarness({ repoDir: dir, version: "v0.2.0" });

    expect(result).toEqual({
      status: "ran",
      previousTag: "v0.1.0",
      fixtures: false,
      tests: false,
    });
  }, 300_000);

  // A-411: --version picks test/upgrade/<vN>/: its fixtures load into the previous release's
  // database, then its tests run against the migrated one.
  it("TP-14.7 (A-411): --version v0.2.0 with test/upgrade/v0.2.0/ holding fixtures and one test: the fixtures load and the test runs", async () => {
    const dir = releasedRepo();
    const caseDir = path.join(dir, "apps/server/test/upgrade/v0.2.0");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(
      path.join(caseDir, "fixtures.sql"),
      // An existing table: the schema step refuses tables without grants (F-19).
      "INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at) VALUES ('loaded', now(), 1, now() + interval '1 day');\n",
    );
    const marker = path.join(dir, "marker.txt");
    writeFileSync(
      path.join(caseDir, "fixture.test.ts"),
      `import { writeFileSync } from "node:fs";
import pg from ${JSON.stringify(path.join(SERVER_DIR, "node_modules/pg/lib/index.js"))};
import { expect, it } from "vitest";

it("reads the fixture row after the migrations", async () => {
  const client = new pg.Client({ connectionString: process.env["UPGRADE_DATABASE_URL"] });
  await client.connect();
  const { rows } = await client.query("SELECT bucket_key AS note FROM rate_limit_counters");
  await client.end();
  writeFileSync(${JSON.stringify(marker)}, String(rows[0]?.note));
  expect(rows).toHaveLength(1);
});
`,
    );

    const result = await runUpgradeHarness({ repoDir: dir, version: "v0.2.0" });

    expect(result).toEqual({ status: "ran", previousTag: "v0.1.0", fixtures: true, tests: true });
    expect(readFileSync(marker, "utf8")).toBe("loaded");
  }, 300_000);

  it.each([
    ["--version release/x", ["--version", "release/x"]],
    ["no --version", []],
  ] as const)(
    "TP-14.7 (A-411): the CLI with %s exits 64 with the usage",
    (_label, args) => {
      const result = spawnSync(
        path.join(SERVER_DIR, "node_modules/.bin/tsx"),
        [path.join(SERVER_DIR, "test/upgrade/harness.ts"), "--repo", repo(["v0.1.0"]), ...args],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(64);
      expect(result.stderr.toLowerCase()).toContain("usage");
    },
    60_000,
  );
});

/**
 * A repository whose v0.1.0 holds the server's baseline migration (F-180's naming, NNNN_<version>,
 * which A-376 accepts), and a node_modules link so the harness finds vitest.
 */
function releasedRepo(): string {
  const fixture = serverFixture();
  try {
    generateBaseline(fixture.dir, "v0.1.0");
    const dir = repo();
    const drizzle = path.join(dir, "apps/server/drizzle");
    mkdirSync(drizzle, { recursive: true });
    cpSync(fixture.drizzle, drizzle, { recursive: true });
    symlinkSync(path.join(SERVER_DIR, "../../node_modules"), path.join(dir, "node_modules"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.invalid",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.invalid",
        },
      });
    git("add", "apps");
    git("commit", "-q", "-m", "release v0.1.0");
    git("tag", "v0.1.0");
    return dir;
  } finally {
    fixture.remove();
  }
}
