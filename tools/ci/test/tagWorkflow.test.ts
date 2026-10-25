// Stage-0 tagging (§4.17 "Stage-0 tagging", D-12): .github/workflows/tag.yml's structure. TP-14.10
// (workflow part), with actionlint 1.7.12 through tools/ci/setup-actionlint.sh (A-367). A-407: two
// jobs, `verify` (read-only, runs tagRelease.sh) and `tag` (contents: write, no repository code,
// creates the ref through the API); A-408: no branch name is hard-coded; A-437 (TP-14.11): three
// jobs, `resolve` (no repository code from the commit; alone has outputs), `verify` (the gate:
// install and check (i) on the resolved commit, no outputs) and `tag`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(ROOT, ".github/workflows/tag.yml");

interface Step {
  uses?: unknown;
  run?: unknown;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  id?: unknown;
}
interface Job {
  permissions?: unknown;
  steps?: Step[];
  environment?: unknown;
  env?: Record<string, unknown>;
  needs?: unknown;
  if?: unknown;
  outputs?: Record<string, unknown>;
}
interface Workflow {
  on?: {
    pull_request?: { types?: unknown; branches?: unknown };
    workflow_dispatch?: { inputs?: Record<string, unknown> };
  } & Record<string, unknown>;
  permissions?: unknown;
  jobs?: Record<string, Job>;
}

function workflow(): Workflow {
  return parse(readFileSync(FILE, "utf8")) as Workflow;
}

const job = (name: string): Job => workflow().jobs?.[name] ?? {};
const runs = (j: Job) => (j.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : ""));
const uses = (j: Job) => (j.steps ?? []).map((s) => (typeof s.uses === "string" ? s.uses : ""));

describe("TP-14.10/TP-14.11: tag.yml (stage 0, A-407, A-408, A-437)", () => {
  it("TP-14.10: the file exists", () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it("TP-14.10: triggers are pull_request closed with no branch filter, and workflow_dispatch with input pr", () => {
    const on = workflow().on ?? {};

    expect(Object.keys(on).sort()).toEqual(["pull_request", "workflow_dispatch"]);
    expect(on.pull_request?.types).toEqual(["closed"]);
    expect(on.pull_request?.branches).toBeUndefined();
    expect(Object.keys(on.workflow_dispatch?.inputs ?? {})).toEqual(["pr"]);
  });

  it("TP-14.11 (A-437): exactly three jobs, resolve, verify and tag; no environment and no signing or deploy", () => {
    const wf = workflow();

    expect(Object.keys(wf.jobs ?? {}).sort()).toEqual(["resolve", "tag", "verify"]);
    for (const j of Object.values(wf.jobs ?? {})) expect(j.environment).toBeUndefined();
    expect(readFileSync(FILE, "utf8")).not.toMatch(/cosign|sigstore|gpg|deploy|id-token/i);
  });

  it("TP-14.11: resolve has exactly contents/pull-requests/checks read, checks out the default branch without credentials, runs no pnpm/node/tsx, and outputs tag and commit", () => {
    const r = job("resolve");
    const checkout = (r.steps ?? []).find(
      (st) => typeof st.uses === "string" && st.uses.startsWith("actions/checkout@"),
    );

    expect(r.permissions).toEqual({ contents: "read", "pull-requests": "read", checks: "read" });
    expect(String(checkout?.with?.["ref"]).replace(/\s+/g, "")).toBe(
      "${{github.event.repository.default_branch}}",
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(uses(r).filter((u) => /pnpm\/action-setup|actions\/setup-node/.test(u))).toEqual([]);
    for (const run of runs(r)) expect(run).not.toMatch(/\b(pnpm|node|npx|tsx)\b/);
    expect(runs(r).some((run) => run.includes("tools/ci/tagRelease.sh"))).toBe(true);
    expect(Object.keys(r.outputs ?? {}).sort()).toEqual(["commit", "tag"]);
  });

  it("TP-14.11 (A-408): resolve's if uses github.event.repository.default_branch; no branch name appears", () => {
    const cond = job("resolve").if;

    expect(typeof cond === "string" ? cond : "").toContain(
      "github.event.repository.default_branch",
    );
    // No quoted branch name and no branch list naming one (comments aside).
    const code = readFileSync(FILE, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/(['"])(main|master)\1|[[,]\s*(main|master)\s*[,\]]/);
  });

  it("TP-14.11: resolve's tagRelease.sh step gets GH_TOKEN and DEFAULT_BRANCH through env:", () => {
    const step = (job("resolve").steps ?? []).find(
      (st) => typeof st.run === "string" && st.run.includes("tools/ci/tagRelease.sh"),
    );

    expect(step?.env?.["GH_TOKEN"]).toEqual(expect.any(String));
    expect(String(step?.env?.["DEFAULT_BRANCH"])).toContain(
      "github.event.repository.default_branch",
    );
  });

  it("TP-14.11: verify needs resolve, has exactly contents: read and no outputs, checks out the resolved commit without credentials and compares HEAD with it; no token in any env", () => {
    const v = job("verify");
    const checkout = (v.steps ?? []).find(
      (st) => typeof st.uses === "string" && st.uses.startsWith("actions/checkout@"),
    );

    expect([v.needs].flat()).toEqual(["resolve"]);
    expect(v.permissions).toEqual({ contents: "read" });
    expect(v.outputs).toBeUndefined();
    expect(String(checkout?.with?.["ref"]).replace(/\s+/g, "")).toBe(
      "${{needs.resolve.outputs.commit}}",
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(runs(v).join("\n")).toMatch(/git rev-parse HEAD/);
    expect(runs(v).join("\n")).toContain("COMMIT");
    const envKeys = [
      ...Object.keys(v.env ?? {}),
      ...(v.steps ?? []).flatMap((st) => Object.keys(st.env ?? {})),
    ];
    expect(envKeys.filter((k) => k === "GH_TOKEN" || k === "GITHUB_TOKEN")).toEqual([]);
    expect(runs(v).join("\n")).toMatch(/pnpm install --frozen-lockfile/);
    expect(runs(v).join("\n")).toMatch(/pnpm db:check-migrations/);
  });

  it("TP-14.11: tag needs resolve and verify, has exactly contents: write, reads only needs.resolve.outputs; needs.verify.outputs appears nowhere", () => {
    const t = job("tag");
    const env = Object.fromEntries(
      (t.steps ?? []).flatMap((st) => Object.entries(st.env ?? {})),
    ) as Record<string, unknown>;

    expect([t.needs].flat().sort()).toEqual(["resolve", "verify"]);
    expect(t.permissions).toEqual({ contents: "write" });
    expect(String(env["TAG"]).replace(/\s+/g, "")).toBe("${{needs.resolve.outputs.tag}}");
    expect(String(env["COMMIT"]).replace(/\s+/g, "")).toBe("${{needs.resolve.outputs.commit}}");
    expect(readFileSync(FILE, "utf8")).not.toContain("needs.verify.outputs");
  });

  it("TP-14.11: tag has no checkout and runs no pnpm, node or tsx; one gh api --method POST to git/refs, every value through env:", () => {
    const t = job("tag");
    const text = runs(t).join("\n");

    expect(uses(t).filter((u) => u !== "")).toEqual([]);
    expect(text).not.toMatch(/\b(pnpm|node|npx|tsx)\b/);
    expect(text.match(/gh api --method POST/g) ?? []).toHaveLength(1);
    expect(text).toMatch(/gh api --method POST "?repos\/\$REPO\/git\/refs"?/);
    expect(text).not.toContain("${{");
  });

  it("TP-14.10: every uses: is pinned to a 40-hex SHA", () => {
    const steps = Object.values(workflow().jobs ?? {}).flatMap((j) => j.steps ?? []);

    for (const s of steps) {
      if (typeof s.uses === "string" && !s.uses.startsWith("./")) {
        expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("TP-14.10: among all workflows only tag.yml grants contents: write", () => {
    const dir = path.join(ROOT, ".github/workflows");
    const writers: string[] = [];
    for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const wf = parse(readFileSync(path.join(dir, name), "utf8")) as Workflow;
      const grants = [wf.permissions, ...Object.values(wf.jobs ?? {}).map((j) => j.permissions)];
      const writes = grants.some(
        (p) =>
          p === "write-all" ||
          (typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>)["contents"] === "write"),
      );
      if (writes) writers.push(name);
    }

    expect(writers).toEqual(["tag.yml"]);
  });
});

describe("TP-14.10 (A-367): actionlint on tag.yml", () => {
  it("TP-14.10: actionlint 1.7.12 (tools/ci/setup-actionlint.sh) passes on tag.yml", () => {
    const setup = spawnSync("bash", [path.join(ROOT, "tools/ci/setup-actionlint.sh")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(setup.status, `${setup.stdout}${setup.stderr}`).toBe(0);

    const lint = spawnSync(
      path.join(ROOT, ".tools/actionlint/actionlint"),
      ["-shellcheck=", "-pyflakes=", ".github/workflows/tag.yml"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(lint.status, `${lint.stdout}${lint.stderr}`).toBe(0);
  }, 120_000);
});

// A-380: the script's body is main, called on the last line, so the checkout can't change it.
describe("TP-14.10 (A-380): tagRelease.sh's structure", () => {
  it("TP-14.10: the script defines main and calls it last", () => {
    const lines = readFileSync(path.join(ROOT, "tools/ci/tagRelease.sh"), "utf8")
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));

    expect(lines.some((l) => /^(function\s+)?main\s*(\(\s*\))?\s*\{?$/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/^main( "\$@")?(\s*;\s*exit( \$\?)?)?$/);
  });
});
