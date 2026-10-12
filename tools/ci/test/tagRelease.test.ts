// tools/ci/tagRelease.sh (stage-0 tagging, §4.17, D-12). TP-14.10 (script part): against a fixture
// repository with an origin, tags v1.2.0 and v1.2.0-hotfix.1, and stub gh and pnpm on PATH.
//
// A-365: the modes are `release` and `hotfix` (any other exits 64 with usage); the script reads the
// pull request with gh fields state, headRefName, baseRefName, headRefOid and mergeCommit (merge
// commit `mergeCommit.oid`), which the stub serves for any `gh pr view … --json` (through jq when
// `--jq` is given); checks are green when `gh pr checks <pr> --required` exits 0.
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
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  jqexpr=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--jq" ] || [ "$prev" = "-q" ]; then jqexpr="$a"; fi
    prev="$a"
  done
  if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$PR_JSON"; else cat "$PR_JSON"; fi
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "checks" ] && [ "$3" = "7" ]; then
  for a in "$@"; do
    if [ "$a" = "--required" ]; then
      echo "checks: exit $GH_CHECKS_EXIT"
      exit "$GH_CHECKS_EXIT"
    fi
  done
fi
echo "stub gh: unsupported: $*" >&2
exit 2
`;

const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $* @ $(git rev-parse HEAD 2>/dev/null)" >> "$STUB_LOG"
exit "$CHECK_I_EXIT"
`;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "budmon-tag-"));
  stubs = path.join(base, "bin");
  mkdirSync(stubs);
  writeFileSync(path.join(stubs, "gh"), GH_STUB);
  writeFileSync(path.join(stubs, "pnpm"), PNPM_STUB);
  chmodSync(path.join(stubs, "gh"), 0o755);
  chmodSync(path.join(stubs, "pnpm"), 0o755);
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

/** A repository with origin; main, release/v1.3.0 merged, v1.2.0, v1.2.0-hotfix.1 and two hotfix heads. */
function fixture(): Fixture {
  const dir = mkdtempSync(path.join(base, "case-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
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
  git("checkout", "-q", "-b", "main");
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
  // release/v1.3.0 merged into main with a merge commit.
  git("checkout", "-q", "main");
  commit("main work");
  git("checkout", "-q", "-b", "release/v1.3.0");
  const release = commit("release");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "Merge release/v1.3.0", "release/v1.3.0");
  const merge = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "--all");
  git("push", "-q", "origin", "--tags");
  return { work, origin, git, commits: { release, merge, hotfix1, head2, headOnBase } };
}

/** The environment without CI or tokens, so each case sets exactly what it tests (A-382). */
function baseEnv(): Record<string, string | undefined> {
  const drop = new Set(["CI", "GITHUB_ACTIONS", "GH_TOKEN", "GITHUB_TOKEN"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !drop.has(key)));
}

function run(
  f: Fixture,
  mode: string,
  pr: Record<string, unknown>,
  opts: { checksExit?: number; checkIExit?: number; env?: Record<string, string> } = {},
) {
  const prJson = path.join(f.work, "..", "pr.json");
  const log = path.join(f.work, "..", "stub.log");
  writeFileSync(prJson, JSON.stringify({ number: 7, ...pr }));
  writeFileSync(log, "");
  const result = spawnSync("bash", [SCRIPT, mode, "7"], {
    cwd: f.work,
    encoding: "utf8",
    env: {
      ...baseEnv(),
      ...GIT_ENV,
      PATH: `${stubs}:${process.env["PATH"] ?? ""}`,
      PR_JSON: prJson,
      STUB_LOG: log,
      GH_CHECKS_EXIT: String(opts.checksExit ?? 0),
      CHECK_I_EXIT: String(opts.checkIExit ?? 0),
      ...opts.env,
    },
  });
  const remoteTags = execFileSync("git", ["ls-remote", "--tags", f.origin], { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    log: readFileSync(log, "utf8"),
    remoteTag: (tag: string) =>
      new RegExp(`^([0-9a-f]{40})\\trefs/tags/${tag.replace(/\./g, "\\.")}$`, "m").exec(
        remoteTags,
      )?.[1] ?? null,
  };
}

const releasePr = (f: Fixture, over: Record<string, unknown> = {}) => ({
  state: "MERGED",
  headRefName: "release/v1.3.0",
  baseRefName: "main",
  headRefOid: f.commits.release,
  mergeCommit: { oid: f.commits.merge },
  ...over,
});

const hotfixPr = (f: Fixture, over: Record<string, unknown> = {}) => ({
  state: "OPEN",
  headRefName: "hotfix/v1.2.0-hotfix.2",
  baseRefName: "main",
  headRefOid: f.commits.head2,
  mergeCommit: null,
  ...over,
});

describe("TP-14.10: tagRelease.sh, release mode", () => {
  it("TP-14.10 (a): a merged release/v1.3.0 PR whose check (i) passes gets v1.3.0 on the merge commit, pushed", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.remoteTag("v1.3.0")).toBe(f.commits.merge);
    expect(r.log).toMatch(/pnpm db:check-migrations/);
  }, 60_000);

  it("TP-14.10 (b): when check (i) fails: exit 1, no tag", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { checkIExit: 1 });

    expect(r.status).toBe(1);
    expect(r.remoteTag("v1.3.0")).toBeNull();
  }, 60_000);

  it("TP-14.10 (c): a PR closed without merge: exit 0, no tag", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f, { state: "CLOSED", mergeCommit: null }));

    expect(r.status, r.output).toBe(0);
    expect(r.remoteTag("v1.3.0")).toBeNull();
  }, 60_000);

  it("TP-14.10 (d): branch release/x: exit 1, branch name invalid", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f, { headRefName: "release/x" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("branch name invalid");
  }, 60_000);

  it("TP-14.10 (k): the tag already exists: exit 1, tag exists, tag unchanged", () => {
    const f = fixture();
    f.git("tag", "v1.3.0", f.commits.release);
    f.git("push", "-q", "origin", "v1.3.0");

    const r = run(f, "release", releasePr(f));

    expect(r.status).toBe(1);
    expect(r.output).toContain("tag exists");
    expect(r.remoteTag("v1.3.0")).toBe(f.commits.release);
  }, 60_000);
});

describe("TP-14.10: tagRelease.sh, hotfix mode", () => {
  it("TP-14.10 (e): an open hotfix/v1.2.0-hotfix.2 PR into main, checks green, built on v1.2.0-hotfix.1: v1.2.0-hotfix.2 on the head, pushed", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.remoteTag("v1.2.0-hotfix.2")).toBe(f.commits.head2);
  }, 60_000);

  it("TP-14.10 (e) (A-365): the checks come from gh pr checks 7 --required", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.log).toMatch(/^gh pr checks 7 .*--required/m);
  }, 60_000);

  it("TP-14.10 (f): the head built on v1.2.0 only: exit 1, not built on v1.2.0-hotfix.1", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { headRefOid: f.commits.headOnBase }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("not built on v1.2.0-hotfix.1");
    expect(r.remoteTag("v1.2.0-hotfix.2")).toBeNull();
  }, 60_000);

  it("TP-14.10 (g): base release/v1.3.0: exit 1, base must be main", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f, { baseRefName: "release/v1.3.0" }));

    expect(r.status).toBe(1);
    expect(r.output).toContain("base must be main");
  }, 60_000);

  it("TP-14.10 (h): a failing check: exit 1, checks not green", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f), { checksExit: 1 });

    expect(r.status).toBe(1);
    expect(r.output).toContain("checks not green");
    expect(r.remoteTag("v1.2.0-hotfix.2")).toBeNull();
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

describe("TP-14.10 (A-365): tagRelease.sh modes", () => {
  it("TP-14.10: tagRelease.sh deploy 12 exits 64 with the usage text, and pushes nothing", () => {
    const f = fixture();
    const before = execFileSync("git", ["ls-remote", "--tags", f.origin], { encoding: "utf8" });

    const r = spawnSync("bash", [SCRIPT, "deploy", "12"], {
      cwd: f.work,
      encoding: "utf8",
      env: { ...baseEnv(), ...GIT_ENV, PATH: `${stubs}:${process.env["PATH"] ?? ""}` },
    });

    expect(r.status, `${r.stdout}${r.stderr}`).toBe(64);
    expect(`${r.stdout}${r.stderr}`.toLowerCase()).toContain("usage");
    expect(execFileSync("git", ["ls-remote", "--tags", f.origin], { encoding: "utf8" })).toBe(
      before,
    );
  }, 60_000);
});

// A-382: an empty GH_TOKEN is allowed only outside CI.
describe("TP-14.10 (A-382): GH_TOKEN and CI", () => {
  it("TP-14.10: with CI set and an empty GH_TOKEN: exit 1, GH_TOKEN missing, before any check", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { env: { CI: "true", GH_TOKEN: "" } });

    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("GH_TOKEN missing");
    expect(r.log).toBe("");
    expect(r.remoteTag("v1.3.0")).toBeNull();
  }, 60_000);

  it("TP-14.10: without CI and with no GH_TOKEN: a plain push (no extraheader) of the tag", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f));

    expect(r.status, r.output).toBe(0);
    expect(r.remoteTag("v1.3.0")).toBe(f.commits.merge);
  }, 60_000);
});
