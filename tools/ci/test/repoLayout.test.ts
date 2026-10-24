// S-0 repository checks: TP-0.1 (§2.1 removals), plus the extra cases TP-0.13x to TP-0.16x for
// the S-0 deliverables and acceptance criteria (§2.2, §9 S-0 AC-2 to AC-4). Root scripts are
// TP-0.21 (rootScripts.test.ts). TP-0.30: the root ESLint config ignores the agents' .claude worktrees
// (A-318).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/** Tracked files plus untracked files that aren't ignored: what a commit of this tree contains. */
function repositoryFiles(): string[] {
  return git("ls-files", "--cached", "--others", "--exclude-standard")
    .split("\n")
    .filter((line) => line !== "");
}

function readRootFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function isIgnored(relative: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", relative], { cwd: ROOT });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relative}: ${String(result.stderr)}`);
  }
  return result.status === 0;
}

describe("TP-0.1: the §2.1 removals", () => {
  it("TP-0.1: nothing under server/ is in the repository", () => {
    expect(repositoryFiles().filter((file) => file.startsWith("server/"))).toEqual([]);
  });

  it.each([["compose.yaml"], ["code-bites.md"], [".prettierrc"]])(
    "TP-0.1: the root %s doesn't exist",
    (file) => {
      expect(existsSync(path.join(ROOT, file))).toBe(false);
    },
  );

  it("TP-0.1: git ls-files has no dist/ path", () => {
    expect(
      git("ls-files")
        .split("\n")
        .filter((file) => /(^|\/)dist\//.test(file)),
    ).toEqual([]);
  });

  it("TP-0.1: .zed/settings.json is kept", () => {
    expect(git("ls-files", ".zed/settings.json").trim()).toBe(".zed/settings.json");
  });
});

describe("TP-0.13x: root workspace files (§2.2)", () => {
  it("TP-0.13x: no vitest.workspace.* file exists (A-8)", () => {
    expect(repositoryFiles().filter((file) => /^vitest\.workspace\./.test(file))).toEqual([]);
  });

  interface RootPackageJson {
    private?: unknown;
    packageManager?: unknown;
    engines?: { node?: unknown };
  }

  function rootPackageJson(): RootPackageJson {
    return JSON.parse(readRootFile("package.json")) as RootPackageJson;
  }

  it("TP-0.13x: package.json is a private workspace root with pnpm 10 pinned and Node 24", () => {
    const pkg = rootPackageJson();

    expect(pkg.private).toBe(true);
    // TP-0.35 (A-490): corepack's sha512 hash is required.
    expect(pkg.packageManager).toMatch(/^pnpm@10\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
    expect(pkg.engines?.node).toBe(">=24 <25");
  });

  it("TP-0.13x: pnpm-workspace.yaml lists exactly the §2.2 workspaces", () => {
    const workspace = parse(readRootFile("pnpm-workspace.yaml")) as { packages?: unknown };

    expect(workspace.packages).toEqual([
      "apps/server",
      "apps/web",
      "packages/*",
      "infra/budmonctl",
      "tools/*",
    ]);
  });

  it("TP-0.13x: .nvmrc is 24", () => {
    expect(readRootFile(".nvmrc").trim()).toBe("24");
  });

  it.each([
    ["apps/server/node_modules/x/index.js"],
    ["packages/shared/node_modules/x/index.js"],
    ["dist/index.js"],
    ["apps/server/dist/main/api.js"],
    ["build/x"],
    ["apps/android/app/build/outputs/x.apk"],
    [".data/objects/x"],
    [".env"],
    [".env.local"],
    ["apps/server/.env"],
    ["coverage/index.html"],
    ["playwright-report/index.html"],
    ["test-results/x.json"],
    ["apps/android/.gradle/x"],
    ["apps/android/local.properties"],
  ])("TP-0.13x: .gitignore ignores %s", (file) => {
    expect(isIgnored(file)).toBe(true);
  });

  it.each([[".env.example"], ["apps/server/.env.example"], ["README.md"]])(
    "TP-0.13x: .gitignore doesn't ignore %s",
    (file) => {
      expect(isIgnored(file)).toBe(false);
    },
  );
});

describe("TP-0.14x: README (S-0 AC-3)", () => {
  function headings(): string[] {
    return [...readRootFile("README.md").matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map(
      (match) => match[1] ?? "",
    );
  }

  it.each([["Layout"], ["Prerequisites"], ["Commands"], ["Environments"]])(
    "TP-0.14x: README has a %s section",
    (section) => {
      expect(
        headings().some((heading) => heading.toLowerCase().startsWith(section.toLowerCase())),
      ).toBe(true);
    },
  );

  it("TP-0.14x: README links to the platform HLD for the stage model", () => {
    expect(readRootFile("README.md")).toMatch(
      /\]\((\.\/)?docs\/design\/platform\/hld\.md(#[^)]*)?\)/,
    );
  });
});

describe("TP-0.15x: proposed CLAUDE.md conventions (S-0 AC-4, HLD D-34)", () => {
  const PROPOSAL = "docs/proposals/claude-md-conventions.md";

  it("TP-0.15x: the proposal file exists", () => {
    expect(existsSync(path.join(ROOT, PROPOSAL))).toBe(true);
  });

  it.each([
    ["the db:reset-only rule", /pnpm db:reset/],
    ["the release/* branch rule", /release\/\*/],
    ["the hotfix/* branch rule", /hotfix\/\*/],
    ["SolidJS", /SolidJS/],
    ["i18n", /i18n|internationali[sz]ation/i],
    ["RTL", /\bRTL\b|right-to-left/i],
    ["accessibility", /accessib/i],
  ])("TP-0.15x: the proposal covers %s", (_label, pattern) => {
    expect(readRootFile(PROPOSAL)).toMatch(pattern);
  });
});

describe("TP-0.16x: CI runs steps 1 to 3 on pull requests (S-0 AC-2, HLD D-27)", () => {
  const CI = ".github/workflows/ci.yml";

  function ci(): string {
    return readRootFile(CI);
  }

  it("TP-0.16x: ci.yml is triggered by pull requests", () => {
    const text = ci();

    expect(text).toMatch(/^(on|"on"|'on'):/m);
    expect(text).toMatch(/\bpull_request\b/);
  });

  it("TP-0.16x: ci.yml installs with pnpm", () => {
    expect(ci()).toMatch(/\bpnpm( run)? install\b|\bpnpm i\b/);
  });

  it("TP-0.16x: ci.yml runs format check, lint, type-check and unit tests (steps 1 and 3)", () => {
    const text = ci();
    const runsCheck = /\bpnpm( run)? check\b(?!:)/.test(text);
    const runsEach =
      /prettier\b[^\n]*--check|\bpnpm( run)? format:check\b/.test(text) &&
      /\bpnpm( run)? lint\b/.test(text) &&
      /\bpnpm( run)? typecheck\b/.test(text) &&
      /\bpnpm( run)? test\b(?!:)/.test(text);

    expect(runsCheck || runsEach).toBe(true);
  });

  it("TP-0.16x: ci.yml runs F-6's migration-file check (step 2)", () => {
    expect(ci()).toMatch(/checkMigrationFiles/);
  });
});

// TP-2.58x (test-architect addition, not an LLD ID): S-2 acceptance criterion 2. Development and
// test databases are pushed from the schema (D-12); apps/server/drizzle stays empty until the
// first release migration (F-180).
describe("TP-2.58x: no migration files before the first release", () => {
  it("TP-2.58x: nothing under apps/server/drizzle/ is in the repository except a placeholder", () => {
    const files = repositoryFiles().filter((file) => file.startsWith("apps/server/drizzle/"));

    expect(files.filter((file) => !/\/\.gitkeep$/.test(file))).toEqual([]);
  });
});

describe("TP-0.30: root ignores cover .claude (A-318)", () => {
  it("TP-0.30: ESLint ignores .claude/worktrees/x/apps/web/src/a.ts and not apps/web/src/a.ts", async () => {
    const eslint = new ESLint({ cwd: ROOT });

    expect(
      await eslint.isPathIgnored(path.join(ROOT, ".claude/worktrees/x/apps/web/src/a.ts")),
    ).toBe(true);
    expect(await eslint.isPathIgnored(path.join(ROOT, "apps/web/src/a.ts"))).toBe(false);
  });

  it("TP-0.30: .prettierignore has a .claude line", () => {
    const lines = readRootFile(".prettierignore")
      .split("\n")
      .map((line) => line.trim());

    expect(lines.some((line) => line === ".claude" || line === ".claude/")).toBe(true);
  });
});

// TP-0.35 (A-490): pnpm comes from packageManager (with corepack's hash, checked in TP-0.13x),
// never from a second version input.
describe("TP-0.35: pnpm's version has one source (A-490)", () => {
  it("TP-0.35: package.json's packageManager carries a sha512 hash", () => {
    const pkg = JSON.parse(readRootFile("package.json")) as { packageManager?: unknown };

    expect(pkg.packageManager).toMatch(/^pnpm@10\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });

  it("TP-0.35: no pnpm/action-setup step in any workflow has with.version", () => {
    const dir = path.join(ROOT, ".github/workflows");
    const offending: string[] = [];
    let seen = 0;
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const wf = parse(readFileSync(path.join(dir, file), "utf8")) as {
        jobs?: Record<string, { steps?: { uses?: unknown; with?: Record<string, unknown> }[] }>;
      };
      for (const [job, j] of Object.entries(wf.jobs ?? {})) {
        for (const step of j.steps ?? []) {
          if (typeof step.uses === "string" && step.uses.startsWith("pnpm/action-setup@")) {
            seen += 1;
            if (step.with !== undefined && "version" in step.with)
              offending.push(`${file}: ${job}`);
          }
        }
      }
    }

    expect(seen).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });
});

// TP-0.33 (A-360): build outputs stay ignored, but a source package named `build` doesn't.
describe("TP-0.33: .gitignore keeps source packages named build (A-360)", () => {
  const TESTKIT = "apps/android/app/src/test/java/com/budmon/app/build";

  it(`TP-0.33: ${TESTKIT}/AgpPaths.kt isn't ignored`, () => {
    expect(isIgnored(`${TESTKIT}/AgpPaths.kt`)).toBe(false);
  });

  it.each([["apps/android/app/build/x"], ["apps/web/build/x"], ["build/x"]])(
    "TP-0.33: %s is ignored",
    (relative) => {
      expect(isIgnored(relative)).toBe(true);
    },
  );

  const SCHEMA = "apps/android/app/schemas/com.budmon.app.core.db.BudmonDatabase/1.json";

  it("TP-0.33 (A-486): the Room schema export isn't ignored and is tracked", () => {
    expect(isIgnored(SCHEMA)).toBe(false);
    expect(git("ls-files", "--", SCHEMA).split("\n")).toContain(SCHEMA);
  });

  it("TP-0.33: git ls-files lists AgpPaths.kt and BuildPropertiesTest.kt", () => {
    const tracked = git("ls-files", "--", `${TESTKIT}/`).split("\n");

    expect(tracked).toEqual(
      expect.arrayContaining([`${TESTKIT}/AgpPaths.kt`, `${TESTKIT}/BuildPropertiesTest.kt`]),
    );
  });
});

// TP-15.32 (A-406): the pgBackRest pin lives next to the base digest, as the ARG's default.
describe("TP-15.32: images/postgres pins pgBackRest (A-406)", () => {
  const docker = () => readRootFile("images/postgres/Dockerfile");

  it("TP-15.32: ARG PGBACKREST_VERSION has a full PGDG trixie default", () => {
    const value = /^ARG PGBACKREST_VERSION=(\S+)$/m.exec(docker())?.[1];

    expect(value).toMatch(/^2\.[0-9]+\.[0-9]+-[0-9]+\.pgdg13\+[0-9]+$/);
  });

  it("TP-15.32: the RUN installs pgbackrest=${PGBACKREST_VERSION}", () => {
    expect(docker()).toMatch(/^RUN [\s\S]*?pgbackrest=\$\{PGBACKREST_VERSION\}/m);
  });
});
