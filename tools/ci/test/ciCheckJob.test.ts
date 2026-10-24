// TP-2.26: ci.yml's check job runs the integration tests after the unit tests (A-31). TP-2.60: the
// dev-smoke job runs TP-2.18's script on pushes to the default branch only
// (§10.1 CI jobs, A-55, A-408, A-425). TP-0.26:
// Testcontainers pulls Docker Hub images through mirror.gcr.io in CI (A-284). TP-0.29: the catalog
// check runs in CI through pnpm lint (A-316). TP-0.31: the e2e job (A-334), which also covers
// AC-11.2 (the axe report uploaded as an artifact).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { changesRun, outputAlternatives } from "./support/changesJob.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TP-2.26: ci.yml check job", () => {
  it("TP-2.26: one run executes pnpm test and then pnpm test:int", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: { check?: { steps?: { run?: unknown }[] } };
    };
    const runs = (workflow.jobs?.check?.steps ?? [])
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string")
      .map((run) => run.split("\n").map((line) => line.trim()));

    const matching = runs.filter((lines) => {
      const test = lines.indexOf("pnpm test");
      const testInt = lines.indexOf("pnpm test:int");
      return test >= 0 && testInt > test;
    });

    expect(matching).toHaveLength(1);
  });
});

describe("TP-2.60: ci.yml dev-smoke job (A-55, A-408, A-425)", () => {
  it("TP-2.60: on.push.branches is exactly [main, master]; dev-smoke's if is the default-branch push expression; no needs; it runs tools/ci/test/dev-smoke.sh", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      on?: { push?: { branches?: unknown } };
      jobs?: Record<string, { if?: unknown; needs?: unknown; steps?: { run?: unknown }[] }>;
    };
    const job = workflow.jobs?.["dev-smoke"];
    const runs = (job?.steps ?? []).map((step) => step.run).filter((r) => typeof r === "string");

    expect(workflow.on?.push?.branches).toEqual(["main", "master"]);
    expect(typeof job?.if === "string" ? job.if.replace(/\s+/g, " ").trim() : job?.if).toBe(
      "github.event_name == 'push' && github.ref_name == github.event.repository.default_branch",
    );
    expect(job?.needs).toBeUndefined();
    expect(runs.some((r) => r.trim() === "tools/ci/test/dev-smoke.sh")).toBe(true);
  });
});

describe("TP-0.26: ci.yml pulls Docker Hub images through mirror.gcr.io (A-284)", () => {
  const VARIABLE = "TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX";

  interface Step {
    name?: unknown;
    uses?: unknown;
    run?: unknown;
    env?: Record<string, unknown>;
  }
  interface Job {
    env?: Record<string, unknown>;
    steps?: Step[];
  }

  function workflow(): { env?: Record<string, unknown>; jobs?: Record<string, Job> } {
    return parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      env?: Record<string, unknown>;
      jobs?: Record<string, Job>;
    };
  }

  it("TP-0.26: the top-level env sets TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX to exactly mirror.gcr.io/", () => {
    expect(workflow().env?.[VARIABLE]).toBe("mirror.gcr.io/");
  });

  it("TP-0.26: no job or step env overrides it, and no step's run unsets or rewrites it", () => {
    const offenders: string[] = [];
    for (const [jobName, job] of Object.entries(workflow().jobs ?? {})) {
      if (job.env !== undefined && VARIABLE in job.env) offenders.push(`${jobName}.env`);
      for (const [i, step] of (job.steps ?? []).entries()) {
        const where = `${jobName}.steps[${String(i)}]`;
        if (step.env !== undefined && VARIABLE in step.env) offenders.push(`${where}.env`);
        if (typeof step.run === "string" && step.run.includes(VARIABLE)) {
          offenders.push(`${where}.run`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("TP-0.26: the check job has no docker login step and no secrets. reference", () => {
    const check = workflow().jobs?.["check"];
    expect(check).toBeDefined();
    const steps = check?.steps ?? [];

    const logins = steps.filter(
      (step) =>
        (typeof step.run === "string" && /docker\s+login/.test(step.run)) ||
        (typeof step.uses === "string" && step.uses.includes("login-action")),
    );

    expect(logins).toEqual([]);
    expect(JSON.stringify(check)).not.toContain("secrets.");
  });
});

describe("TP-0.29: the catalog check runs in CI through pnpm lint (A-316)", () => {
  function scripts(relative: string): Record<string, unknown> {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return pkg.scripts ?? {};
  }

  it("TP-0.29: root lint is exactly eslint . && pnpm lint:css && pnpm lint:catalogs", () => {
    expect(scripts("package.json")["lint"]).toBe("eslint . && pnpm lint:css && pnpm lint:catalogs");
  });

  it("TP-0.29: root lint:catalogs delegates to @budmon/tools-ci, whose lint:catalogs is tsx checkCatalogs.ts", () => {
    expect(scripts("package.json")["lint:catalogs"]).toBe(
      "pnpm --filter @budmon/tools-ci lint:catalogs",
    );
    expect(scripts("tools/ci/package.json")["lint:catalogs"]).toBe("tsx checkCatalogs.ts");
  });

  it("TP-0.29: the check job runs pnpm lint", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs?: { check?: { steps?: { run?: unknown }[] } };
    };
    const lines = (workflow.jobs?.check?.steps ?? [])
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string")
      .flatMap((run) => run.split("\n").map((line) => line.trim()));

    expect(lines).toContain("pnpm lint");
  });
});

describe("TP-0.31: ci.yml e2e job (A-334)", () => {
  interface Step {
    uses?: unknown;
    run?: unknown;
    if?: unknown;
    with?: Record<string, unknown>;
  }
  const workflow = () =>
    parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      on?: Record<string, unknown>;
      jobs?: Record<string, { if?: unknown; steps?: Step[] }>;
    };
  const runLines = (steps: readonly Step[]) =>
    steps
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .flatMap((r) => r.split("\n").map((line) => line.trim()));

  it("TP-0.31: the e2e job runs on pull_request", () => {
    const wf = workflow();
    const job = wf.jobs?.["e2e"];

    expect(job).toBeDefined();
    expect(Object.keys(wf.on ?? {})).toContain("pull_request");
    expect(typeof job?.if === "string" ? job.if : "").not.toMatch(/push|refs\/heads\/main/);
  });

  it("TP-0.31: a step runs playwright install --with-deps chromium", () => {
    const lines = runLines(workflow().jobs?.["e2e"]?.steps ?? []);

    expect(lines.some((l) => /playwright install --with-deps chromium$/.test(l))).toBe(true);
  });

  it("TP-0.31: a step runs pnpm test:e2e with --project=chromium and --project=pseudo-rtl and no other --project", () => {
    const lines = runLines(workflow().jobs?.["e2e"]?.steps ?? []).filter((l) =>
      l.startsWith("pnpm test:e2e"),
    );

    expect(lines).toHaveLength(1);
    const projects = [...(lines[0] ?? "").matchAll(/--project[= ](\S+)/g)].map((m) => m[1]);
    expect(projects.sort()).toEqual(["chromium", "pseudo-rtl"]);
  });

  it("TP-0.31, AC-11.2: the last step uploads apps/web/playwright-report/ as playwright-report with a SHA-pinned actions/upload-artifact and if: always()", () => {
    const steps = workflow().jobs?.["e2e"]?.steps ?? [];
    const last = steps.at(-1);

    expect(typeof last?.uses === "string" ? last.uses : "").toMatch(
      /^actions\/upload-artifact@[0-9a-f]{40}$/,
    );
    expect(last?.if).toBe("always()");
    expect(last?.with?.["name"]).toBe("playwright-report");
    expect(last?.with?.["path"]).toBe("apps/web/playwright-report/");
  });
});

// TP-0.32 (A-351): CI step 6, the changes and android jobs (replaces the earlier TP-13.18x).
describe("TP-0.32: ci.yml android job (A-351)", () => {
  interface AStep {
    uses?: unknown;
    run?: unknown;
    if?: unknown;
    with?: Record<string, unknown>;
    "working-directory"?: unknown;
  }
  interface AJob {
    needs?: unknown;
    if?: unknown;
    outputs?: Record<string, unknown>;
    defaults?: { run?: { "working-directory"?: unknown } };
    steps?: AStep[];
  }
  const jobsOf = () =>
    (
      parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
        jobs?: Record<string, AJob>;
      }
    ).jobs ?? {};
  const text = (v: unknown) => (typeof v === "string" ? v : "");

  it("TP-0.32: android needs changes and runs on its android output or a release/hotfix head branch", () => {
    const android = jobsOf()["android"];
    const cond = text(android?.if);

    expect([android?.needs].flat()).toContain("changes");
    expect(cond).toMatch(/needs\.changes\.outputs\.android\s*==\s*'true'/);
    expect(cond).toMatch(/release\//);
    expect(cond).toMatch(/hotfix\//);
  });

  // A-424: only the android output's line is inspected.
  it("TP-0.32 (A-424): the changes job diffs origin/${BASE_REF}...HEAD, has an android output, and the android line lists exactly the four paths", () => {
    const changes = jobsOf()["changes"];

    expect(changes).toBeDefined();
    expect(changesRun(ROOT)).toMatch(
      /git (-c \S+ )*diff[^\n]*--name-only[^\n]*"origin\/\$\{BASE_REF\}\.\.\.HEAD"/,
    );
    expect(Object.keys(changes?.outputs ?? {})).toContain("android");
    expect(outputAlternatives(ROOT, "android")?.sort()).toEqual(
      [
        "apps/android/",
        "packages/shared/test-vectors/",
        "packages/contract/openapi.json",
        ".github/workflows/ci.yml",
      ].sort(),
    );
  });

  it("TP-0.32: steps run in apps/android: ./gradlew testDebugUnitTest lint ktlintCheck; connectedDebugAndroidTest only on release candidates", () => {
    const android = jobsOf()["android"];
    const steps = android?.steps ?? [];
    const dir = (s: AStep) =>
      s["working-directory"] ?? android?.defaults?.run?.["working-directory"];
    const unit = steps.filter((s) =>
      /\.\/gradlew testDebugUnitTest lint ktlintCheck/.test(text(s.run)),
    );
    const connected = steps.filter(
      (s) =>
        /connectedDebugAndroidTest/.test(text(s.run)) ||
        /connectedDebugAndroidTest/.test(text(s.with?.["script"])),
    );

    expect(unit).toHaveLength(1);
    expect(dir(unit[0] ?? {})).toBe("apps/android");
    expect(connected).toHaveLength(1);
    const c = connected[0] ?? {};
    expect(text(c.if)).toMatch(/release\//);
    expect(text(c.if)).toMatch(/hotfix\//);
    expect(text(c.uses)).toMatch(/^reactivecircus\/android-emulator-runner@[0-9a-f]{40}$/);
    expect(String(c.with?.["api-level"])).toBe("34");
  });

  it("TP-0.32: Temurin 21 through actions/setup-java and gradle/actions/setup-gradle; every uses: SHA-pinned", () => {
    const steps = jobsOf()["android"]?.steps ?? [];
    const java = steps.find((s) => text(s.uses).startsWith("actions/setup-java@"));

    expect(java?.with?.["distribution"]).toBe("temurin");
    expect(String(java?.with?.["java-version"])).toBe("21");
    expect(steps.some((s) => text(s.uses).startsWith("gradle/actions/setup-gradle@"))).toBe(true);
    for (const s of [...steps, ...(jobsOf()["changes"]?.steps ?? [])]) {
      if (text(s.uses) !== "" && !text(s.uses).startsWith("./")) {
        expect(text(s.uses)).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  // TP-0.34 (A-486): the Room schema is uploaded, then compared with the committed export.
  it("TP-0.34 (A-486): directly after the unit-test step, the room-schemas upload then the committed-export check", () => {
    const steps = (jobsOf()["android"]?.steps ?? []) as (AStep & { name?: unknown })[];
    const unit = steps.findIndex((s) => text(s.run).includes("./gradlew testDebugUnitTest"));
    expect(unit).toBeGreaterThanOrEqual(0);
    const upload = steps[unit + 1];
    const check = steps[unit + 2];

    expect(upload?.name).toBe("Room schema artifact (A-486)");
    expect(upload?.if).toBe("always()");
    expect(text(upload?.uses)).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(upload?.with?.["name"]).toBe("room-schemas");
    expect(upload?.with?.["path"]).toBe("apps/android/app/schemas/");
    expect(upload?.with?.["if-no-files-found"]).toBe("warn");

    expect(check?.name).toBe("Room schema matches the committed export (A-486)");
    expect(check?.["working-directory"]).toBe("apps/android");
    expect(text(check?.run)).toContain(
      "git status --porcelain --untracked-files=all -- app/schemas",
    );
    expect(text(check?.run)).toContain("::error::");
    expect(text(check?.run)).toContain("exit 1");
    expect(check !== undefined && "if" in check).toBe(false);
  });
});
