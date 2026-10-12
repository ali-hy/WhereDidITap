// F-183 the upgrade harness at the baseline. TP-14.7.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";
import { generatePlain, serverFixture } from "../../support/s14.js";
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
    expect(await runUpgradeHarness({ repoDir: repo() })).toEqual({ status: "skipped: baseline" });
  });

  it('TP-14.7: the CLI prints "skipped: baseline" and exits 0', () => {
    const dir = repo();
    const result = spawnSync(
      path.join(SERVER_DIR, "node_modules/.bin/tsx"),
      [path.join(SERVER_DIR, "test/upgrade/harness.ts"), "--repo", dir],
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
    const fixture = serverFixture();
    try {
      // F-180's naming (`NNNN_<version>`), which A-376's journal tag pattern accepts.
      generatePlain(fixture.dir, "v0.1.0");
      const dir = repo();
      const drizzle = path.join(dir, "apps/server/drizzle");
      mkdirSync(drizzle, { recursive: true });
      cpSync(fixture.drizzle, drizzle, { recursive: true });
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
      git("add", "-A");
      git("commit", "-q", "-m", "release v0.1.0");
      git("tag", "v0.1.0");

      const result = await runUpgradeHarness({ repoDir: dir, version: "v0.2.0" });

      expect(result).toEqual({
        status: "ran",
        previousTag: "v0.1.0",
        fixtures: false,
        tests: false,
      });
    } finally {
      fixture.remove();
    }
  }, 300_000);
});
