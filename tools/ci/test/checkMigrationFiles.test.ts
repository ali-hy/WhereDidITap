// F-6 checkMigrationFiles. TP-0.5, plus the extra cases TP-0.11x and TP-0.27x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// F-6 lives at `tools/ci/checkMigrationFiles.ts` (A-7).
import { describe, expect, it } from "vitest";
import { checkMigrationFiles } from "../checkMigrationFiles.js";

const MIGRATION = "apps/server/drizzle/0001.sql";
const PLACEHOLDER = "apps/server/drizzle/.gitkeep";
const MESSAGE_SUFFIX =
  ". Move these changes to a release/* or hotfix/* branch, or remove them from this pull request.";
const MESSAGE_PREFIX =
  "Migration files may only change on release/* and hotfix/* branches (D-12): ";

describe("F-6 checkMigrationFiles", () => {
  describe("TP-0.5", () => {
    it("TP-0.5: a migration file changed on a feature branch fails and lists the file", () => {
      const result = checkMigrationFiles({
        branch: "feat/x",
        changedFiles: [MIGRATION],
        isHotfixMergeBack: false,
      });

      expect(result).toEqual({
        ok: false,
        message: `${MESSAGE_PREFIX}${MIGRATION}${MESSAGE_SUFFIX}`,
      });
    });

    it("TP-0.5: the same change on release/v1.0.0 passes", () => {
      expect(
        checkMigrationFiles({
          branch: "release/v1.0.0",
          changedFiles: [MIGRATION],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });

    it("TP-0.5: a feature branch without migration changes passes", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: ["apps/server/src/platform/db/client.ts", "README.md"],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });

    it("TP-0.5: a hotfix merge-back passes even from a non-release branch name", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: [MIGRATION],
          isHotfixMergeBack: true,
        }),
      ).toEqual({ ok: true });
    });

    it("TP-0.5: an infra/ branch passes", () => {
      expect(
        checkMigrationFiles({
          branch: "infra/v1.0.0-infra.1",
          changedFiles: [MIGRATION],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });
  });

  // A-92: F-6 ignores exactly apps/server/drizzle/.gitkeep, and nothing else under the folder.
  describe("TP-0.5: the drizzle/.gitkeep placeholder (A-92)", () => {
    it("TP-0.5: feat/x changing only apps/server/drizzle/.gitkeep passes", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: [PLACEHOLDER],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });

    it("TP-0.5: .gitkeep with 0001.sql fails and lists only 0001.sql", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: [PLACEHOLDER, MIGRATION],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: false, message: `${MESSAGE_PREFIX}${MIGRATION}${MESSAGE_SUFFIX}` });
    });

    it("TP-0.5: apps/server/drizzle/meta/.gitkeep fails and is listed", () => {
      const file = "apps/server/drizzle/meta/.gitkeep";

      expect(
        checkMigrationFiles({ branch: "feat/x", changedFiles: [file], isHotfixMergeBack: false }),
      ).toEqual({ ok: false, message: `${MESSAGE_PREFIX}${file}${MESSAGE_SUFFIX}` });
    });
  });

  // TP-0.27x (A-92): only the exact path is ignored; other dotfiles and near-misses still count.
  describe("TP-0.27x: near misses of the placeholder path", () => {
    it.each([
      ["another dotfile", "apps/server/drizzle/.gitignore"],
      ["a longer name", "apps/server/drizzle/.gitkeep.bak"],
      ["a .gitkeep in another subfolder", "apps/server/drizzle/x/.gitkeep"],
    ])("TP-0.27x: %s (%s) on feat/x fails and is listed", (_label, file) => {
      expect(
        checkMigrationFiles({ branch: "feat/x", changedFiles: [file], isHotfixMergeBack: false }),
      ).toEqual({ ok: false, message: `${MESSAGE_PREFIX}${file}${MESSAGE_SUFFIX}` });
    });

    it("TP-0.27x: a .gitkeep outside apps/server/drizzle/ is not a migration file", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: ["apps/server/.gitkeep", "apps/server/drizzle-x/.gitkeep"],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });
  });

  // TP-0.11x (added): boundaries of F-6's branch pattern `^(release|hotfix|infra)/` and of
  // "under apps/server/drizzle/".
  describe("TP-0.11x: branch and path boundaries", () => {
    it("TP-0.11x: a hotfix/ branch passes", () => {
      expect(
        checkMigrationFiles({
          branch: "hotfix/v1.0.1",
          changedFiles: [MIGRATION],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });

    it.each([["releases/v1.0.0"], ["feat/release/v1.0.0"], ["release"], ["Release/v1.0.0"]])(
      "TP-0.11x: branch %s doesn't match the anchored pattern and fails",
      (branch) => {
        const result = checkMigrationFiles({
          branch,
          changedFiles: [MIGRATION],
          isHotfixMergeBack: false,
        });

        expect(result).toEqual({
          ok: false,
          message: `${MESSAGE_PREFIX}${MIGRATION}${MESSAGE_SUFFIX}`,
        });
      },
    );

    it("TP-0.11x: any file under apps/server/drizzle/, including the journal, fails", () => {
      const journal = "apps/server/drizzle/meta/_journal.json";

      const result = checkMigrationFiles({
        branch: "feat/x",
        changedFiles: [journal],
        isHotfixMergeBack: false,
      });

      expect(result).toEqual({
        ok: false,
        message: `${MESSAGE_PREFIX}${journal}${MESSAGE_SUFFIX}`,
      });
    });

    it("TP-0.11x: files that only share the prefix (drizzle.config.ts) pass", () => {
      expect(
        checkMigrationFiles({
          branch: "feat/x",
          changedFiles: ["apps/server/drizzle.config.ts", "apps/server/drizzle-notes.md"],
          isHotfixMergeBack: false,
        }),
      ).toEqual({ ok: true });
    });

    it('TP-0.11x: with several migration files changed, the message lists them in input order joined with ", "', () => {
      const second = "apps/server/drizzle/0002.sql";

      const result = checkMigrationFiles({
        branch: "feat/x",
        changedFiles: [MIGRATION, "README.md", second],
        isHotfixMergeBack: false,
      });

      expect(result).toEqual({
        ok: false,
        message: `${MESSAGE_PREFIX}${MIGRATION}, ${second}${MESSAGE_SUFFIX}`,
      });
    });

    it("TP-0.11x: an empty change list passes", () => {
      expect(
        checkMigrationFiles({ branch: "feat/x", changedFiles: [], isHotfixMergeBack: false }),
      ).toEqual({ ok: true });
    });
  });
});
