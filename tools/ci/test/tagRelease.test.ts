// tools/ci/tagRelease.sh (stage-0 tagging, §4.17, D-12), verify only (A-407). TP-14.10 (script
// part): against a fixture repository whose default branch is `master` (A-408), with an origin,
// tags v1.2.0 and v1.2.0-hotfix.1, and stubs on PATH:
//   - gh: `pr view … --json state,headRefName,baseRefName,headRefOid,mergeCommit` (A-365) serves
//     $PR_JSON (through jq when --jq is given); `pr checks <pr> --json name,bucket` (A-414) serves
//     $CHECKS_JSON (default: one passing check);
//   - pnpm: logs `pnpm <args> @ <HEAD>` (so check (i)'s commit is visible, review B-2) and exits
//     $CHECK_I_EXIT for db:check-migrations, 0 otherwise;
//   - git: a recording wrapper around the real git, so "no git push and no git tag" is checked.
// The script writes tag=… and commit=… to $GITHUB_OUTPUT and never pushes; run locally (no
// GITHUB_OUTPUT) it prints them and the commands to create the tag by hand.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "tools/ci/tagRelease.sh");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

let base: string;
let stubs: string;

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
jqexpr=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--jq" ] || [ "$prev" = "-q" ]; then jqexpr="$a"; fi
  prev="$a"
done
serve() {
  if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$1"; else cat "$1"; fi
}
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  serve "$PR_JSON"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then
  serve "$CHECKS_FILE"
  exit 0
fi
echo "stub gh: unsupported: $*" >&2
exit 2
`;

const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $* @ $(command git rev-parse HEAD 2>/dev/null)" >> "$STUB_LOG"
case " $* " in
  *" db:check-migrations "*) exit "$CHECK_I_EXIT" ;;
esac
exit 0
`;

/** Logs every git invocation, then runs the real git. */
const gitStub = (realGit: string) => `#!/usr/bin/env bash
echo "git $*" >> "$STUB_LOG"
exec "${realGit}" "$@"
`;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "budmon-tag-"));
  stubs = path.join(base, "bin");
  mkdirSync(stubs);
  const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(path.join(stubs, "gh"), GH_STUB);
  writeFileSync(path.join(stubs, "pnpm"), PNPM_STUB);
  writeFileSync(path.join(stubs, "git"), gitStub(realGit));
  for (const s of ["gh", "pnpm", "git"]) chmodSync(path.join(stubs, s), 0o755);
});
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Fixture {
  work: string;
  origin: string;
  git: (...args: string[]) => string;
  commits: { release: string; merge: string; hotfix1: string; head2: string; headOnBase: string };
}

/**
 * A repository with origin; default branch master, release/v1.3.0 merged into it, v1.2.0,
 * v1.2.0-hotfix.1 and two hotfix heads.
 */
function fixture(): Fixture {
  const dir = mkdtempSync(path.join(base, "case-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", origin]);
  execFileSync("git", ["clone", "-q", origin, work], { stdio: "ignore" });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, ...GIT_ENV },
    }).trim();
  const commit = (msg: string) => {
    writeFileSync(path.join(work, "f.txt"), `${msg}\n`);
    git("add", "f.txt");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  git("checkout", "-q", "-b", "master");
  commit("init");
  git("tag", "v1.2.0");
  // hotfix.1 from v1.2.0, tagged.
  git("checkout", "-q", "-b", "hotfix/v1.2.0-hotfix.1", "v1.2.0");
  const hotfix1 = commit("hotfix 1");
  git("tag", "v1.2.0-hotfix.1");
  // hotfix.2 built on hotfix.1.
  git("checkout", "-q", "-b", "hotfix/v1.2.0-hotfix.2", "v1.2.0-hotfix.1");
  const head2 = commit("hotfix 2");
  // A hotfix.2 head built on v1.2.0 only.
  git("checkout", "-q", "-b", "hotfix-on-base", "v1.2.0");
  const headOnBase = commit("hotfix 2 on base");
  // release/v1.3.0 merged into master with a merge commit.
  git("checkout", "-q", "master");
  commit("master work");
  git("checkout", "-q", "-b", "release/v1.3.0");
  const release = commit("release");
  git("checkout", "-q", "master");
  git("merge", "-q", "--no-ff", "-m", "Merge release/v1.3.0", "release/v1.3.0");
  const merge = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "--all");
  git("push", "-q", "origin", "--tags");
  return { work, origin, git, commits: { release, merge, hotfix1, head2, headOnBase } };
}

/** The environment without CI or tokens, so each case sets exactly what it tests. */
function baseEnv(): Record<string, string | undefined> {
  const drop = new Set(["CI", "GITHUB_ACTIONS", "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_OUTPUT"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !drop.has(key)));
}

const PASSING = [{ name: "check", bucket: "pass" }];

interface RunOptions {
  checks?: readonly { name: string; bucket: string }[];
  checkIExit?: number;
  /** false: run locally (no GITHUB_OUTPUT). */
  githubOutput?: boolean;
  /** undefined: DEFAULT_BRANCH unset. */
  defaultBranch?: string | undefined;
}

function run(f: Fixture, mode: string, pr: Record<string, unknown>, opts: RunOptions = {}) {
  const prJson = path.join(f.work, "..", "pr.json");
  const checksFile = path.join(f.work, "..", "checks.json");
  const log = path.join(f.work, "..", "stub.log");
  const output = path.join(f.work, "..", "github-output");
  writeFileSync(prJson, JSON.stringify({ number: 7, ...pr }));
  writeFileSync(checksFile, JSON.stringify(opts.checks ?? PASSING));
  writeFileSync(log, "");
  writeFileSync(output, "");
  const defaultBranch = "defaultBranch" in opts ? opts.defaultBranch : "master";
  const result = spawnSync("bash", [SCRIPT, mode, "7"], {
    cwd: f.work,
    encoding: "utf8",
    env: {
      ...baseEnv(),
      ...GIT_ENV,
      PATH: `${stubs}:${process.env["PATH"] ?? ""}`,
      PR_JSON: prJson,
      CHECKS_FILE: checksFile,
      STUB_LOG: log,
      CHECK_I_EXIT: String(opts.checkIExit ?? 0),
      GH_TOKEN: "ghs_readonly_test_token",
      ...(opts.githubOutput === false ? {} : { GITHUB_OUTPUT: output }),
      ...(defaultBranch === undefined ? {} : { DEFAULT_BRANCH: defaultBranch }),
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const stubLog = readFileSync(log, "utf8");
  return {
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}${result.stderr}`,
    outputs,
    log: stubLog,
    /** git calls that would create or push a tag. */
    tagWrites: stubLog
      .split("\n")
      .filter((l) => /^git (.* )?(push|tag)( |$)/.test(l) && !/^git (.* )?tag -l\b/.test(l)),
    remoteTags: execFileSync("git", ["ls-remote", "--tags", f.origin], { encoding: "utf8" }),
  };
}

/** The log line for check (i) on `commit` (review B-2). */
const checkIOn = (commit: string) =>
  new RegExp(`^pnpm (.* )?db:check-migrations( .*)? @ ${commit}$`, "m");

const releasePr = (f: Fixture, over: Record<string, unknown> = {}) => ({
  state: "MERGED",
  headRefName: "release/v1.3.0",
  baseRefName: "master",
  headRefOid: f.commits.release,
  mergeCommit: { oid: f.commits.merge },
  ...over,
});

const hotfixPr = (f: Fixture, over: Record<string, unknown> = {}) => ({
  state: "OPEN",
  headRefName: "hotfix/v1.2.0-hotfix.2",
  baseRefName: "master",
  headRefOid: f.commits.head2,
  mergeCommit: null,
  ...over,
});

describe("TP-14.10: tagRelease.sh, release mode", () => {
  it("TP-14.10 (a): a merged release/v1.3.0 PR whose check (i) passes outputs tag=v1.3.0 and the merge commit; no git push or git tag", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.outputs).toEqual({ tag: "v1.3.0", commit: f.commits.merge });
    expect(r.tagWrites).toEqual([]);
    expect(r.remoteTags).not.toContain("refs/tags/v1.3.0");
    // Review B-2: check (i) ran on the commit being tagged.
    expect(r.log).toMatch(checkIOn(f.commits.merge));
  }, 60_000);

  it("TP-14.10 (b): when check (i) fails: exit 1, no outputs", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { checkIExit: 1 });

    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (c): a PR closed without merge: exit 0, no outputs", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f, { state: "CLOSED", mergeCommit: null }));

    expect(r.status, r.output).toBe(0);
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (d): branch release/x: exit 1, branch name invalid", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f, { headRefName: "release/x" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("branch name invalid");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (k): the tag already exists: exit 1, tag exists, no outputs", () => {
    const f = fixture();
    f.git("tag", "v1.3.0", f.commits.release);
    f.git("push", "-q", "origin", "v1.3.0");

    const r = run(f, "release", releasePr(f));

    expect(r.status).toBe(1);
    expect(r.output).toContain("tag exists");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (n): run locally (no GITHUB_OUTPUT): prints tag and commit and the manual commands, and pushes nothing", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { githubOutput: false });

    expect(r.status, r.output).toBe(0);
    expect(r.stdout).toMatch(/^tag=v1\.3\.0$/m);
    expect(r.stdout).toMatch(new RegExp(`^commit=${f.commits.merge}$`, "m"));
    // The two commands to create the tag by hand name the tag and the commit.
    const commandLines = r.stdout
      .split("\n")
      .filter((l) => l.includes("v1.3.0") && !l.startsWith("tag="));
    expect(commandLines.length).toBeGreaterThanOrEqual(2);
    expect(commandLines.join("\n")).toContain(f.commits.merge);
    expect(r.tagWrites).toEqual([]);
    expect(r.remoteTags).not.toContain("refs/tags/v1.3.0");
  }, 60_000);
});

describe("TP-14.10: tagRelease.sh, hotfix mode", () => {
  it("TP-14.10 (e): an open hotfix/v1.2.0-hotfix.2 PR into master, checks pass, built on v1.2.0-hotfix.1: outputs tag=v1.2.0-hotfix.2 and the head", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.outputs).toEqual({ tag: "v1.2.0-hotfix.2", commit: f.commits.head2 });
    expect(r.tagWrites).toEqual([]);
    // Review B-2: check (i) ran on the head.
    expect(r.log).toMatch(checkIOn(f.commits.head2));
    // A-414: the checks come from gh pr checks 7 --json name,bucket, not --required.
    expect(r.log).toMatch(/^gh pr checks 7 .*--json name,bucket/m);
    expect(r.log).not.toMatch(/--required/);
  }, 60_000);

  it("TP-14.10 (e) (A-414): a skipping check counts as green", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f), {
      checks: [
        { name: "check", bucket: "pass" },
        { name: "android", bucket: "skipping" },
      ],
    });

    expect(r.status, r.output).toBe(0);
    expect(r.outputs).toEqual({ tag: "v1.2.0-hotfix.2", commit: f.commits.head2 });
  }, 60_000);

  it("TP-14.10 (f): the head built on v1.2.0 only: exit 1, not built on v1.2.0-hotfix.1", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { headRefOid: f.commits.headOnBase }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("not built on v1.2.0-hotfix.1");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (g): base release/v1.3.0: exit 1, base must be the default branch", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { baseRefName: "release/v1.3.0" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("base must be the default branch");
  }, 60_000);

  it("TP-14.10 (h): a failing check: exit 1, checks not green", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f), {
      checks: [
        { name: "check", bucket: "pass" },
        { name: "migrations", bucket: "fail" },
      ],
    });

    expect(r.status).toBe(1);
    expect(r.output).toContain("checks not green");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (h2) (A-414): no checks at all: exit 1, checks not green", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f), { checks: [] });

    expect(r.status).toBe(1);
    expect(r.output).toContain("checks not green");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (i): a closed PR: exit 1, pull request not open", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { state: "CLOSED" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("pull request not open");
  }, 60_000);

  it("TP-14.10 (j): branch hotfix/v1.2.1: exit 1, branch name invalid", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { headRefName: "hotfix/v1.2.1" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("branch name invalid");
  }, 60_000);
});

describe("TP-14.10: tagRelease.sh usage (A-365, A-408)", () => {
  it("TP-14.10 (l): mode deploy exits 64 with the usage text and no outputs", () => {
    const f = fixture();

    const r = run(f, "deploy", releasePr(f));

    expect(r.status, r.output).toBe(64);
    expect(r.output.toLowerCase()).toContain("usage");
    expect(r.outputs).toEqual({});
  }, 60_000);

  it("TP-14.10 (m): DEFAULT_BRANCH unset exits 64 before any check", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { defaultBranch: undefined });

    expect(r.status, r.output).toBe(64);
    expect(r.log).not.toMatch(/^(gh|pnpm) /m);
    expect(r.outputs).toEqual({});
  }, 60_000);
});
