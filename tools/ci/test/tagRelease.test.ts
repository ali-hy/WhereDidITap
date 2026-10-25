// tools/ci/tagRelease.sh (stage-0 tagging, §4.17, D-12), verify only (A-407). TP-14.10 (script
// part): against a fixture repository whose default branch is `master` (A-408), with an origin,
// tags v1.2.0 and v1.2.0-hotfix.1, and stubs on PATH:
//   - gh: `pr view … --json state,headRefName,baseRefName,headRefOid,mergeCommit` (A-365) serves
//     $PR_JSON (through jq when --jq is given); `pr checks <pr> --json name,bucket` (A-414) serves
//     $CHECKS_JSON (default: one passing check);
//   - pnpm: logs `pnpm <args> @ <HEAD>` (so check (i)'s commit is visible, review B-2) and exits
//     $CHECK_I_EXIT for db:check-migrations, 0 otherwise;
//   - git: a recording wrapper around the real git, so "no git push and no git tag" is checked.
// The script (the `resolve` job's, A-437) writes tag=… and commit=… to $GITHUB_OUTPUT and never
// pushes, checks out or runs repository code (no pnpm); run locally (no GITHUB_OUTPUT) it prints
// them and the commands to create the tag by hand. TP-14.11's integration part runs tag.yml's three
// jobs' run blocks against the same fixture.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

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
  views=$(( $(cat "$VIEW_COUNT" 2>/dev/null || echo 0) + 1 ))
  echo "$views" > "$VIEW_COUNT"
  # (o): from the second view on, another head (a push during the checks).
  if [ "$views" -ge 2 ] && [ -n "\${PR_JSON_2:-}" ]; then serve "$PR_JSON_2"; else serve "$PR_JSON"; fi
  exit 0
fi
if [ "$1" = "api" ]; then
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
  /** (o): the PR as later `gh pr view` calls see it. */
  prLater?: Record<string, unknown>;
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
  const prJson2 = path.join(f.work, "..", "pr2.json");
  const viewCount = path.join(f.work, "..", "view-count");
  writeFileSync(prJson, JSON.stringify({ number: 7, ...pr }));
  writeFileSync(prJson2, JSON.stringify({ number: 7, ...(opts.prLater ?? pr) }));
  rmSync(viewCount, { force: true });
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
      ...(opts.prLater === undefined ? {} : { PR_JSON_2: prJson2 }),
      VIEW_COUNT: viewCount,
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
    // A-437: resolve runs no repository code from the commit: no checkout.
    expect(r.log).not.toMatch(/^git (.* )?checkout( |$)/m);
  }, 60_000);

  it("TP-14.10 (b) (A-437): with a pnpm stub that would fail, the outputs are as (a) and pnpm is never called", () => {
    const f = fixture();

    const r = run(f, "release", releasePr(f), { checkIExit: 1 });

    expect(r.status, r.output).toBe(0);
    expect(r.outputs).toEqual({ tag: "v1.3.0", commit: f.commits.merge });
    expect(r.log).not.toMatch(/^pnpm /m);
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

  it("TP-14.10 (o) (A-437): the head changes during the checks: exit 1, head changed during the checks, no outputs", () => {
    const f = fixture();

    const r = run(f, "hotfix", hotfixPr(f), {
      prLater: hotfixPr(f, { headRefOid: f.commits.headOnBase }),
    });

    expect(r.status).toBe(1);
    expect(r.output).toContain("head changed during the checks");
    expect(r.outputs).toEqual({});
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

// ---- TP-14.11 (A-437): tag.yml's jobs run in order, each with its own GITHUB_OUTPUT. ----

interface WfStep {
  uses?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}
interface WfJob {
  steps?: WfStep[];
  env?: Record<string, unknown>;
}

const tagWorkflow = () =>
  (
    parse(readFileSync(path.join(ROOT, ".github/workflows/tag.yml"), "utf8")) as {
      jobs?: Record<string, WfJob>;
    }
  ).jobs ?? {};

/** GitHub's output-file rules: `name=value` lines and `name<<DELIM` … `DELIM` blocks. */
function parseGithubOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc !== null) {
      const [, name = "", delim = ""] = heredoc;
      const value: string[] = [];
      for (i += 1; i < lines.length && lines[i] !== delim; i += 1) value.push(lines[i] ?? "");
      out[name] = value.join("\n");
    } else if (line.includes("=")) {
      out[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
    }
  }
  return out;
}

/** Resolves a step's `env:` from a fixed table of expressions; anything else fails the test. */
function resolveEnv(
  env: Record<string, unknown> | undefined,
  table: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).map(([key, raw]) => {
      const text = String(raw);
      const expr = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(text)?.[1];
      if (expr === undefined) return [key, text];
      const value = table[expr];
      if (value === undefined) throw new Error(`unmapped expression in env ${key}: ${expr}`);
      return [key, value];
    }),
  );
}

/** Runs a job's run blocks in `cwd` with bash -eo pipefail; returns its outputs and status. */
function runJob(
  job: WfJob | undefined,
  cwd: string,
  table: Record<string, string>,
  extraEnv: Record<string, string>,
): { status: number | null; outputs: Record<string, string>; output: string } {
  const outFile = mkdtempSync(path.join(base, "out-"));
  const githubOutput = path.join(outFile, "GITHUB_OUTPUT");
  writeFileSync(githubOutput, "");
  let output = "";
  for (const step of job?.steps ?? []) {
    if (typeof step.run !== "string") continue;
    expect(step.run, "no ${{ in a run block (A-17)").not.toContain("${{");
    const r = spawnSync("bash", ["-eo", "pipefail", "-c", step.run], {
      cwd,
      encoding: "utf8",
      env: {
        ...baseEnv(),
        ...GIT_ENV,
        ...extraEnv,
        ...resolveEnv(job?.env, table),
        ...resolveEnv(step.env, table),
        GITHUB_OUTPUT: githubOutput,
      },
    });
    output += `${r.stdout}${r.stderr}`;
    if (r.status !== 0) return { status: r.status, outputs: {}, output };
  }
  return { status: 0, outputs: parseGithubOutput(readFileSync(githubOutput, "utf8")), output };
}

/** A pnpm that tries to forge the job's outputs (A-437's attack). */
const FORGING_PNPM = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_LOG"
{
  echo "commit<<EOF"
  echo "${"f".repeat(40)}"
  echo "EOF"
  echo "tag=v9.9.9"
} >> "$GITHUB_OUTPUT"
exit 0
`;

describe("TP-14.11 (A-437): tag.yml's job graph isolates the outputs", () => {
  it("TP-14.11 (I): resolve, verify (with a forging pnpm) and tag: the gh api call tags the merge commit as v1.3.0; the forged values appear nowhere", () => {
    const f = fixture();
    const jobs = tagWorkflow();
    const dir = path.join(f.work, "..");
    const log = path.join(dir, "stub.log");
    const prJson = path.join(dir, "pr.json");
    const checksFile = path.join(dir, "checks.json");
    writeFileSync(prJson, JSON.stringify({ number: 7, ...releasePr(f) }));
    writeFileSync(checksFile, JSON.stringify(PASSING));
    writeFileSync(log, "");
    const forging = path.join(dir, "forging-bin");
    mkdirSync(forging);
    writeFileSync(path.join(forging, "pnpm"), FORGING_PNPM);
    chmodSync(path.join(forging, "pnpm"), 0o755);
    // resolve checks out the default branch, which carries the script.
    mkdirSync(path.join(f.work, "tools/ci"), { recursive: true });
    copyFileSync(SCRIPT, path.join(f.work, "tools/ci/tagRelease.sh"));
    const stubEnv = {
      PATH: `${forging}:${stubs}:${process.env["PATH"] ?? ""}`,
      PR_JSON: prJson,
      CHECKS_FILE: checksFile,
      STUB_LOG: log,
      VIEW_COUNT: path.join(dir, "view-count"),
      CHECK_I_EXIT: "0",
    };
    const exprs: Record<string, string> = {
      "github.token": "ghs_test_token",
      "github.event.repository.default_branch": "master",
      "github.event_name": "pull_request",
      "github.event.pull_request.number": "7",
      "inputs.pr": "",
      "github.repository": "owner/repo",
      "github.head_ref": "release/v1.3.0",
    };

    const resolved = runJob(jobs["resolve"], f.work, exprs, stubEnv);
    expect(resolved.status, resolved.output).toBe(0);
    expect(resolved.outputs).toEqual({ tag: "v1.3.0", commit: f.commits.merge });

    const withResolve = {
      ...exprs,
      "needs.resolve.outputs.tag": resolved.outputs["tag"] ?? "",
      "needs.resolve.outputs.commit": resolved.outputs["commit"] ?? "",
    };
    // actions/checkout with ref: needs.resolve.outputs.commit.
    f.git("checkout", "-q", "--detach", f.commits.merge);
    const verified = runJob(jobs["verify"], f.work, withResolve, stubEnv);
    expect(verified.status, verified.output).toBe(0);
    // The attack happened: the forging pnpm ran in verify and its values reached verify's own
    // outputs, which tag must not read.
    expect(readFileSync(log, "utf8")).toMatch(/^pnpm /m);
    expect(verified.outputs["commit"]).toBe("f".repeat(40));
    expect(verified.outputs["tag"]).toBe("v9.9.9");

    const tagged = runJob(jobs["tag"], f.work, withResolve, stubEnv);
    expect(tagged.status, tagged.output).toBe(0);

    const calls = readFileSync(log, "utf8");
    const api = calls.split("\n").filter((l) => l.startsWith("gh api"));
    expect(api).toHaveLength(1);
    expect(api[0]).toContain(`sha=${f.commits.merge}`);
    expect(api[0]).toContain("ref=refs/tags/v1.3.0");
    expect(calls).not.toContain("f".repeat(40));
    expect(calls).not.toContain("v9.9.9");
  }, 120_000);
});

// TP-14.10 (p): the tag job re-validates both values before any gh call.
describe("TP-14.10 (p): the tag job's run block refuses bad values", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";

  it.each([
    ["TAG v1.3.0;x", { TAG: "v1.3.0;x", COMMIT: SHA }, "invalid tag:"],
    ["a multi-line TAG", { TAG: "v1.3.0\nv9.9.9", COMMIT: SHA }, "invalid tag:"],
    ["COMMIT HEAD", { TAG: "v1.3.0", COMMIT: "HEAD" }, "invalid commit:"],
    ["a multi-line COMMIT", { TAG: "v1.3.0", COMMIT: `${SHA}\n${SHA}` }, "invalid commit:"],
  ] as const)("TP-14.10 (p): %s exits 1 with no gh call", (_label, values, message) => {
    const steps = tagWorkflow()["tag"]?.steps ?? [];
    const script = steps.map((st) => (typeof st.run === "string" ? st.run : "")).join("\n");
    expect(script).toContain("gh api");
    const dir = mkdtempSync(path.join(base, "p-"));
    const log = path.join(dir, "stub.log");
    writeFileSync(log, "");

    const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...baseEnv(),
        PATH: `${stubs}:${process.env["PATH"] ?? ""}`,
        STUB_LOG: log,
        GH_TOKEN: "ghs_test_token",
        REPO: "owner/repo",
        ...values,
      },
    });

    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain(message);
    expect(readFileSync(log, "utf8")).not.toMatch(/^gh /m);
  });
});
