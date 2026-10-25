// F-195 default steps 2 and 6 (A-452): the previous-db fixtures load, and upgrade-assertions'
// throwaway Postgres, restore, F-183 invocation and cleanup, with every other step replaced.
// TP-16.22.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadRun,
  type Exec,
  type ExecOptions,
  type RunModule,
  type StepFn,
  type StepName,
} from "./support/load.js";

let m: RunModule;
beforeAll(async () => {
  m = await loadRun();
});

interface Call {
  cmd: string;
  args: string[];
  o: ExecOptions;
}

let repoRoot: string;
let workDir: string;
const caseDir = () => path.join(repoRoot, "apps/server/test/upgrade/v1.2.0");

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "budmon-tp16-22-repo-"));
  workDir = mkdtempSync(path.join(tmpdir(), "budmon-tp16-22-work-"));
  mkdirSync(path.join(repoRoot, "images/postgres"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "images/postgres/Dockerfile"),
    "FROM postgres:18@sha256:abc\nCOPY x /y\n",
  );
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function writeCase(files: Record<string, string>) {
  mkdirSync(caseDir(), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(caseDir(), name), text);
}

const ORDER: StepName[] = [
  "secrets",
  "previous-db",
  "migrate",
  "stack-up",
  "ready",
  "upgrade-assertions",
  "canary-flows",
  "scan",
  "mailpit-quiet",
  "no-stage-setting",
  "cross-role-secrets",
  "gate-commands",
  "maintenance",
  "rollback",
  "smoke",
];

const joined = (c: Call) => [c.cmd, ...c.args].join(" ");
const isUpgradePgReady = (c: Call) =>
  c.o.step === "upgrade-assertions" && c.args.includes("pg_isready");
const isRunContainer = (c: Call) => c.cmd === "docker" && c.args[0] === "run";
const isVitest = (c: Call) => c.cmd.endsWith("node_modules/.bin/vitest");

async function run(answer: (c: Call) => number | undefined = () => undefined): Promise<{
  result: Awaited<ReturnType<RunModule["runRehearsal"]>>;
  calls: Call[];
  called: string[];
  elapsed: number;
}> {
  const calls: Call[] = [];
  const called: string[] = [];
  const exec: Exec = (cmd, args, o) => {
    const c = { cmd, args, o };
    calls.push(c);
    const forced = answer(c);
    if (forced !== undefined) return Promise.resolve({ code: forced, stdout: "" });
    if ((o.input ?? "").includes("FROM pg_roles")) {
      return Promise.resolve({ code: 0, stdout: "budmon_app\nbudmon_migrator\n" });
    }
    return Promise.resolve({ code: 0, stdout: "" });
  };
  const replaced = Object.fromEntries(
    ORDER.filter((n) => n !== "previous-db" && n !== "upgrade-assertions").map((n) => [
      n,
      (() => {
        called.push(n);
        return Promise.resolve({ ok: true, detail: "" });
      }) satisfies StepFn,
    ]),
  ) as Partial<Record<StepName, StepFn>>;
  const start = 1_760_000_000_000;
  let clock = start;
  const ok: StepFn = () => Promise.resolve({ ok: true, detail: "" });
  const result = await m.runRehearsal(
    {
      previousTag: "v1.1.0",
      version: "v1.2.0",
      images: { server: "s", web: "w", postgres: "p" },
      workDir,
      repoRoot,
    },
    {
      exec,
      http: () => Promise.reject(new Error("no http")),
      steps: replaced,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      collectArtifacts: ok,
      cleanup: ok,
    },
  );
  return { result, calls, called, elapsed: clock - start };
}

const record = (r: Awaited<ReturnType<RunModule["runRehearsal"]>>, name: string) =>
  r.steps.find((s) => s.name === name);

/** The upgrade-assertions calls as short labels, in order. */
function labels(calls: Call[]): string[] {
  return calls
    .filter((c) => c.o.step === "upgrade-assertions")
    .map((c) => {
      const all = joined(c);
      if (c.cmd === "sh" && all.includes("pg_dump -Fc -U budmon_admin budmon")) return "dump";
      if ((c.o.input ?? "").includes("FROM pg_roles")) return "roles";
      if (isRunContainer(c)) return "run";
      if (c.args.includes("pg_isready")) return "ready";
      if ((c.o.input ?? "").includes("CREATE DATABASE budmon;")) return "create";
      if (all.includes("pg_restore --exit-on-error -U postgres -d budmon")) return "restore";
      if (isVitest(c)) return "vitest";
      if (all === "docker rm -f budmon-rehearsal-upgrade") return "rm-container";
      if (c.cmd === "rm") return "rm-dump";
      return `other: ${all}`;
    });
}

describe("TP-16.22: previous-db's fixtures and upgrade-assertions (F-195, A-452)", () => {
  // A-492, A-494: the previous release's images run as opts.previousTag (v1.1.0).
  it("TP-16.22 (a) (A-492): the previous migrate runs with BUDMON_TAG and REHEARSAL_RELEASE v1.1.0; the candidate's Compose calls with rehearsal and v1.2.0", async () => {
    writeCase({ "fixtures.sql": "SELECT 1;", "b.test.ts": "", "a.test.ts": "" });

    const { calls } = await run();

    const prev = calls.filter((c) => c.o.step === "previous-db");
    const migrate = prev.find((c) => joined(c).includes(" migrate"));
    expect(migrate?.o.env?.["BUDMON_TAG"]).toBe("v1.1.0");
    expect(migrate?.o.env?.["REHEARSAL_RELEASE"]).toBe("v1.1.0");

    const candidate = prev.filter(
      (c) =>
        (c.args.includes("up") && c.args.includes("-d") && c.args.includes("postgres")) ||
        c.o.input === "SELECT 1;",
    );
    expect(candidate).toHaveLength(2);
    for (const c of candidate) {
      expect(c.o.env?.["BUDMON_TAG"], joined(c)).toBe("rehearsal");
      expect(c.o.env?.["REHEARSAL_RELEASE"], joined(c)).toBe("v1.2.0");
    }
  });

  it("TP-16.22 (a): fixtures load right after the previous migrate; the upgrade sequence runs in order and passes", async () => {
    writeCase({ "fixtures.sql": "SELECT 1;", "b.test.ts": "", "a.test.ts": "" });

    const { result, calls } = await run();

    // previous-db: psql … -1 -U budmon_admin -d budmon with the file's text, right after migrate.
    const prev = calls.filter((c) => c.o.step === "previous-db");
    const fx = prev.findIndex((c) => c.o.input === "SELECT 1;");
    expect(fx).toBeGreaterThan(0);
    expect(prev[fx]?.args.slice(-11)).toEqual([
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-1",
      "-U",
      "budmon_admin",
      "-d",
      "budmon",
    ]);
    const before = prev[fx - 1];
    expect(before === undefined ? "" : joined(before)).toContain("migrate");
    expect(
      `${before === undefined ? "" : joined(before)} ${JSON.stringify(before?.o.env ?? {})}`,
    ).toContain("v1.1.0");

    expect(labels(calls)).toEqual([
      "dump",
      "roles",
      "run",
      "ready",
      "create",
      "restore",
      "vitest",
      "rm-container",
      "rm-dump",
    ]);

    const ua = calls.filter((c) => c.o.step === "upgrade-assertions");
    const dump = ua.find((c) => c.cmd === "sh");
    expect(dump?.o.env?.["DUMP"]).toBe(path.join(workDir, "upgrade.dump"));

    const container = ua.find(isRunContainer);
    expect(container?.args).toEqual([
      "run",
      "-d",
      "--rm",
      "--name",
      "budmon-rehearsal-upgrade",
      "-e",
      "POSTGRES_PASSWORD",
      "-p",
      "127.0.0.1:15433:5432",
      "postgres:18@sha256:abc",
    ]);
    const password = container?.o.env?.["POSTGRES_PASSWORD"] ?? "";
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    for (const c of calls) expect(c.args.join(" "), joined(c)).not.toContain(password);

    const create = ua.find((c) => (c.o.input ?? "").includes("CREATE DATABASE"));
    expect(
      (create?.o.input ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== ""),
    ).toEqual([
      'CREATE ROLE "budmon_app" NOLOGIN;',
      'CREATE ROLE "budmon_migrator" NOLOGIN;',
      "CREATE DATABASE budmon;",
    ]);

    const vitest = ua.find(isVitest);
    expect(vitest?.cmd).toBe(path.join(repoRoot, "node_modules/.bin/vitest"));
    expect(vitest?.args).toEqual(["run", "--root", caseDir(), "a.test.ts", "b.test.ts"]);
    expect(vitest?.o.env?.["UPGRADE_DATABASE_URL"]).toBe(
      `postgresql://postgres:${password}@127.0.0.1:15433/budmon`,
    );
    expect(ua.find((c) => c.cmd === "rm")?.args).toEqual([
      "-f",
      path.join(workDir, "upgrade.dump"),
    ]);

    expect(record(result, "upgrade-assertions")).toEqual({
      name: "upgrade-assertions",
      ok: true,
      detail: "",
    });
  });

  it("TP-16.22 (b): vitest exiting 1 → upgrade_assertions_failed; the container is still removed; no later step runs", async () => {
    writeCase({ "fixtures.sql": "SELECT 1;", "a.test.ts": "", "b.test.ts": "" });

    const { result, calls, called } = await run((c) => (isVitest(c) ? 1 : undefined));

    expect(record(result, "upgrade-assertions")).toMatchObject({
      ok: false,
      detail: "upgrade_assertions_failed",
    });
    expect(labels(calls)).toContain("rm-container");
    expect(called).not.toContain("canary-flows");
    expect(result.ok).toBe(false);
  });

  it("TP-16.22 (c): docker run exiting 125 → upgrade_pg_failed", async () => {
    writeCase({ "fixtures.sql": "SELECT 1;", "a.test.ts": "" });

    const { result } = await run((c) => (isRunContainer(c) ? 125 : undefined));

    expect(record(result, "upgrade-assertions")).toMatchObject({
      ok: false,
      detail: "upgrade_pg_failed",
    });
  });

  it("TP-16.22 (d): a folder with fixtures.sql only: fixtures loaded; upgrade-assertions skipped with no exec call", async () => {
    writeCase({ "fixtures.sql": "SELECT 1;" });

    const { result, calls } = await run();

    expect(calls.some((c) => c.o.step === "previous-db" && c.o.input === "SELECT 1;")).toBe(true);
    expect(record(result, "upgrade-assertions")).toEqual({
      name: "upgrade-assertions",
      ok: true,
      detail: "skipped: no upgrade tests for v1.2.0",
    });
    expect(calls.filter((c) => c.o.step === "upgrade-assertions")).toEqual([]);
  });

  it("TP-16.22 (e): no folder: no fixtures call; upgrade-assertions skipped the same way", async () => {
    const { result, calls } = await run();

    expect(calls.some((c) => c.o.input !== undefined && c.o.step === "previous-db")).toBe(false);
    expect(record(result, "upgrade-assertions")).toEqual({
      name: "upgrade-assertions",
      ok: true,
      detail: "skipped: no upgrade tests for v1.2.0",
    });
    expect(calls.filter((c) => c.o.step === "upgrade-assertions")).toEqual([]);
  });

  it("TP-16.22 (f): pg_isready never 0 → upgrade_pg_not_ready after the 60 s deadline; the container is removed", async () => {
    writeCase({ "a.test.ts": "" });

    const { result, calls, elapsed } = await run((c) => (isUpgradePgReady(c) ? 2 : undefined));

    expect(record(result, "upgrade-assertions")).toMatchObject({
      ok: false,
      detail: "upgrade_pg_not_ready",
    });
    expect(elapsed).toBeGreaterThanOrEqual(60_000);
    expect(labels(calls)).toContain("rm-container");
    expect(labels(calls)).not.toContain("vitest");
  });
});
