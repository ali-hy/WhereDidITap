// F-185 buildNumber and its CLI. TP-14.6.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "../buildNumber.js";

async function buildNumber(): Promise<(revCount: number) => number> {
  return ((await import(/* @vite-ignore */ MODULE)) as { buildNumber: (n: number) => number })
    .buildNumber;
}

describe("TP-14.6: buildNumber (F-185)", () => {
  it.each([
    [1, 1],
    [412, 412],
  ])("TP-14.6: buildNumber(%i) is %i", async (count, expected) => {
    expect((await buildNumber())(count)).toBe(expected);
  });

  it.each([[0], [-3], [1.5], [Number.NaN]])(
    "TP-14.6: buildNumber(%d) is a RangeError",
    async (count) => {
      const fn = await buildNumber();

      expect(() => fn(count)).toThrow(RangeError);
    },
  );

  it("TP-14.6: the CLI in a repo with 3 commits and v0.1.0 on the third prints 3", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "budmon-buildnumber-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: repo,
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
      for (const n of [1, 2, 3]) {
        writeFileSync(path.join(repo, "f.txt"), String(n));
        git("add", "f.txt");
        git("commit", "-q", "-m", `c${String(n)}`);
      }
      git("tag", "v0.1.0");
      writeFileSync(path.join(repo, "f.txt"), "4");
      git("commit", "-q", "-am", "c4 after the tag");

      const result = spawnSync(
        path.join(TOOLS, "node_modules/.bin/tsx"),
        [path.join(TOOLS, "buildNumber.ts"), "v0.1.0"],
        { cwd: repo, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("3");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});
