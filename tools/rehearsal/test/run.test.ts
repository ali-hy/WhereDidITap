// F-195 runRehearsal (A-442): the runner's order, skips, sub-step records, rejections, stop on
// the first failure, and artifacts then cleanup always (TP-16.3); default step 7's sub-steps and
// their X-Budmon-Client headers (A-33), with every other step replaced (TP-16.16).
import { CANARIES } from "@budmon/test-support";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadRun,
  type Exec,
  type ExecOptions,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type RehearsalOptions,
  type RunModule,
  type StepFn,
  type StepName,
  type StepOutcome,
} from "./support/load.js";

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

let m: RunModule;
beforeAll(async () => {
  m = await loadRun();
});

const opts = (previousTag: string | null): RehearsalOptions => ({
  previousTag,
  version: "v1.0.0",
  images: { server: "budmon/server:rc", web: "budmon/web:rc", postgres: "budmon/postgres:rc" },
  workDir: "/tmp/budmon-rehearsal-unit",
  repoRoot: "/repo",
});

const throwingExec: Exec = () => Promise.reject(new Error("exec must not be called"));
const throwingHttp: Http = () => Promise.reject(new Error("http must not be called"));

/** All 15 steps as recording fakes; `override` replaces the outcome of named ones. */
function recordingSteps(override: Partial<Record<StepName, () => Promise<StepOutcome>>> = {}) {
  const called: string[] = [];
  const steps = Object.fromEntries(
    ORDER.map((name) => [
      name,
      (() => {
        called.push(name);
        return override[name]?.() ?? Promise.resolve({ ok: true, detail: "" });
      }) satisfies StepFn,
    ]),
  ) as unknown as Record<StepName, StepFn>;
  return { called, steps };
}

function recordingTail(cleanupOutcome: StepOutcome = { ok: true, detail: "" }) {
  const tail: string[] = [];
  return {
    tail,
    collectArtifacts: (() => {
      tail.push("artifacts");
      return Promise.resolve({ ok: true, detail: "" });
    }) satisfies StepFn,
    cleanup: (() => {
      tail.push("cleanup");
      return Promise.resolve(cleanupOutcome);
    }) satisfies StepFn,
  };
}

describe("TP-16.3: the runner (F-195, A-442)", () => {
  it("TP-16.3 (f): STEP_ORDER is exactly steps 1 to 14 with 8b as mailpit-quiet", () => {
    expect([...m.STEP_ORDER]).toEqual(ORDER);
  });

  it("TP-16.3 (a): ready failing stops the run after it; artifacts then cleanup run once; ok false", async () => {
    const { called, steps } = recordingSteps({
      ready: () => Promise.resolve({ ok: false, detail: "x" }),
    });
    const t = recordingTail();

    const result = await m.runRehearsal(opts("v1.0.0"), {
      exec: throwingExec,
      http: throwingHttp,
      steps,
      collectArtifacts: t.collectArtifacts,
      cleanup: t.cleanup,
    });

    expect(result.steps.map((s) => s.name)).toEqual([
      "secrets",
      "previous-db",
      "migrate",
      "stack-up",
      "ready",
      "artifacts",
      "cleanup",
    ]);
    expect(result.steps.find((s) => s.name === "ready")).toEqual({
      name: "ready",
      ok: false,
      detail: "x",
    });
    expect(called).toEqual(["secrets", "previous-db", "migrate", "stack-up", "ready"]);
    expect(t.tail).toEqual(["artifacts", "cleanup"]);
    expect(result.ok).toBe(false);
  });

  it("TP-16.3 (b): previousTag null: 15 records in order, the two upgrade steps skipped without being called, ok true", async () => {
    const { called, steps } = recordingSteps();
    const t = recordingTail();

    const result = await m.runRehearsal(opts(null), {
      exec: throwingExec,
      http: throwingHttp,
      steps,
      collectArtifacts: t.collectArtifacts,
      cleanup: t.cleanup,
    });

    expect(result.steps.map((s) => s.name)).toEqual([...ORDER, "artifacts", "cleanup"]);
    for (const name of ["upgrade-assertions", "rollback"]) {
      expect(result.steps.find((s) => s.name === name)).toEqual({
        name,
        ok: true,
        detail: "skipped: no previous release",
      });
    }
    expect(called).toEqual(ORDER.filter((n) => n !== "upgrade-assertions" && n !== "rollback"));
    expect(t.tail).toEqual(["artifacts", "cleanup"]);
    expect(result.ok).toBe(true);
  });

  it("TP-16.3 (c): migrate rejecting with TypeError is recorded ok false, detail error: TypeError; nothing after it but artifacts and cleanup", async () => {
    const { called, steps } = recordingSteps({
      migrate: () => Promise.reject(new TypeError(`secret ${CANARIES.token}`)),
    });
    const t = recordingTail();

    const result = await m.runRehearsal(opts("v1.0.0"), {
      exec: throwingExec,
      http: throwingHttp,
      steps,
      collectArtifacts: t.collectArtifacts,
      cleanup: t.cleanup,
    });

    expect(result.steps.map((s) => s.name)).toEqual([
      "secrets",
      "previous-db",
      "migrate",
      "artifacts",
      "cleanup",
    ]);
    expect(result.steps[2]).toEqual({ name: "migrate", ok: false, detail: "error: TypeError" });
    // The message is never recorded.
    expect(JSON.stringify(result)).not.toContain(CANARIES.token);
    expect(called).toEqual(["secrets", "previous-db", "migrate"]);
    expect(result.ok).toBe(false);
  });

  it("TP-16.3 (d): canary-flows' sub-step is recorded right after it as canary-flows/<name>; a skipped one keeps the run ok", async () => {
    const { steps } = recordingSteps({
      "canary-flows": () =>
        Promise.resolve({
          ok: true,
          detail: "",
          subSteps: [{ name: "bootstrap-owner", ok: true, detail: "skipped: identity not built" }],
        }),
    });
    const t = recordingTail();

    const result = await m.runRehearsal(opts("v1.0.0"), {
      exec: throwingExec,
      http: throwingHttp,
      steps,
      collectArtifacts: t.collectArtifacts,
      cleanup: t.cleanup,
    });

    const names = result.steps.map((s) => s.name);
    const at = names.indexOf("canary-flows");
    expect(names[at + 1]).toBe("canary-flows/bootstrap-owner");
    expect(names[at + 2]).toBe("scan");
    expect(result.steps[at + 1]).toEqual({
      name: "canary-flows/bootstrap-owner",
      ok: true,
      detail: "skipped: identity not built",
    });
    expect(result.ok).toBe(true);
  });

  it("TP-16.3 (e): every step succeeding but cleanup returning ok false makes the run ok false", async () => {
    const { steps } = recordingSteps();
    const t = recordingTail({ ok: false, detail: "down failed" });

    const result = await m.runRehearsal(opts("v1.0.0"), {
      exec: throwingExec,
      http: throwingHttp,
      steps,
      collectArtifacts: t.collectArtifacts,
      cleanup: t.cleanup,
    });

    expect(result.steps.at(-1)).toEqual({ name: "cleanup", ok: false, detail: "down failed" });
    expect(result.ok).toBe(false);
  });
});

// ---- TP-16.16: default step 7 ----

const tok = (prefix: string, fill: string) => `${prefix}_${fill.repeat(43).slice(0, 43)}`;
const BOOTSTRAP = tok("bmi", "B");
const ACCESS = tok("bma", "A");
const REFRESH = tok("bmr", "R");
const INVITE_MAIL = tok("bmi", "I");
const RESET_MAIL = tok("bmp", "P");
const HANDOFF = tok("bmh", "H");
const OWNER = "rehearsal-owner.7f3a@example.invalid";
const MAILPIT = "http://127.0.0.1:8025";

const reply = (status: number, body: unknown, headers: Record<string, string | string[]> = {}) =>
  Promise.resolve<HttpResponse>({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Identity, Caddy and Mailpit as TP-16.14 (b) and 7b have them. */
function fakeHttp(buildNumber: number) {
  const requests: HttpRequest[] = [];
  const http: Http = (req) => {
    requests.push(req);
    const origin = req.origin ?? "http://127.0.0.1:8080";
    const p = req.path.split("?")[0] ?? "";
    if (origin === MAILPIT) {
      if (p === "/api/v1/messages") {
        return reply(200, {
          messages: [
            { ID: "m1", To: [{ Name: "", Address: CANARIES.email }] },
            { ID: "m2", To: [{ Name: "", Address: OWNER }] },
          ],
        });
      }
      if (p === "/api/v1/message/m1") {
        return reply(200, {
          Text: `Join: https://localhost:8080/invite#t=${INVITE_MAIL}`,
          HTML: "",
        });
      }
      if (p === "/api/v1/message/m2") {
        return reply(200, { Text: "", HTML: `<a href="/reset#t=${RESET_MAIL}">reset</a>` });
      }
      return reply(404, {});
    }
    switch (`${req.method} ${p}`) {
      case "GET /version.json":
        return reply(200, { buildNumber });
      case "GET /api/v1/meta/client-config":
        return reply(200, { apiVersion: "1.0", web: { minimumBuild: 40 } });
      case "POST /api/v1/invitations/accept":
        return reply(200, { accessToken: ACCESS, refreshToken: REFRESH, user: { id: "u" } });
      case "POST /api/v1/invitations":
        return reply(201, { id: "i" });
      case "POST /api/v1/auth/password-reset/request":
        return reply(202, {});
      case "POST /api/v1/auth/google/start":
        return reply(
          200,
          {
            authorizationUrl:
              "https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=state-7f3a-xyz&nonce=nonce-7f3a-xyz",
          },
          {
            "set-cookie": [
              "__Host-budmon_gbind=bind-7f3a; Path=/; HttpOnly; Secure; SameSite=Strict",
            ],
          },
        );
      case "GET /api/v1/auth/google/callback":
        return Promise.resolve({
          status: 303,
          headers: { location: `/auth/google/done#h=${HANDOFF}` },
          body: "",
        });
      case "POST /api/v1/auth/google/complete":
        return reply(404, {
          defined: true,
          code: "GOOGLE_ACCOUNT_UNKNOWN",
          status: 404,
          message: "No account for this Google account.",
          data: { email: CANARIES.email },
        });
      default:
        return reply(404, { defined: true, code: "NOT_FOUND", status: 404, message: "Not found." });
    }
  };
  return { http, requests };
}

function fakeExec() {
  const calls: { cmd: string; args: string[]; o: ExecOptions }[] = [];
  const exec: Exec = (cmd, args, o) => {
    calls.push({ cmd, args, o });
    if (o.step === "canary-flows/bootstrap-owner") {
      return Promise.resolve({
        code: 0,
        stdout: `Invitation link: http://localhost:8080/invite#t=${BOOTSTRAP}\n`,
      });
    }
    return Promise.resolve({ code: 0, stdout: "" });
  };
  return { exec, calls };
}

async function runStep7(buildNumber: number) {
  const { http, requests } = fakeHttp(buildNumber);
  const { exec, calls } = fakeExec();
  let clock = 1_760_000_000_000;
  const replaced = Object.fromEntries(
    ORDER.filter((n) => n !== "canary-flows").map((n) => [
      n,
      (() => Promise.resolve({ ok: true, detail: "" })) satisfies StepFn,
    ]),
  ) as Partial<Record<StepName, StepFn>>;
  const ok: StepFn = () => Promise.resolve({ ok: true, detail: "" });
  const result = await m.runRehearsal(opts(null), {
    exec,
    http,
    steps: replaced,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    collectArtifacts: ok,
    cleanup: ok,
  });
  return { result, requests, calls };
}

const identity = (r: HttpRequest) =>
  (r.origin ?? "http://127.0.0.1:8080") !== MAILPIT &&
  r.path !== "/version.json" &&
  !r.path.startsWith("/api/v1/meta/");
const header = (r: HttpRequest, name: string) =>
  Object.entries(r.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

describe("TP-16.16: step 7's sub-steps and X-Budmon-Client (F-195, A-33, A-442)", () => {
  it("TP-16.16: canary-flows runs the checks with vitest.checks.config.ts in tools/rehearsal (A-445)", async () => {
    const { calls } = await runStep7(42);
    const flows = calls.find((c) => c.o.step === "canary-flows");

    expect(flows?.cmd).toBe("pnpm");
    expect(flows?.args).toEqual([
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.checks.config.ts",
      "checks/canaryFlows.test.ts",
    ]);
    expect(flows?.o.cwd).toBe("/repo/tools/rehearsal");
    expect(flows?.o.env).toMatchObject({
      REHEARSAL_BASE_URL: "http://127.0.0.1:8080",
      REHEARSAL_HOST: "localhost:8080",
      REHEARSAL_FX_CONTROL_URL: "http://127.0.0.1:18082",
    });
  });

  it("TP-16.16: buildNumber 42: 7c's three identity requests each carry X-Budmon-Client web/42; no 7b request carries one", async () => {
    const { result, requests } = await runStep7(42);

    const google = requests.filter((r) => r.path.startsWith("/api/v1/auth/google/"));
    expect(google.map((r) => `${r.method} ${r.path.split("?")[0] ?? ""}`)).toEqual([
      "POST /api/v1/auth/google/start",
      "GET /api/v1/auth/google/callback",
      "POST /api/v1/auth/google/complete",
    ]);
    for (const r of google) expect(header(r, "X-Budmon-Client")).toBe("web/42");
    expect(google.every((r) => r.step === "canary-flows/google-sign-in")).toBe(true);

    const sevenB = requests.filter((r) => r.step === "canary-flows/email-canary");
    expect(sevenB.length).toBeGreaterThan(0);
    for (const r of sevenB) expect(header(r, "X-Budmon-Client")).toBeUndefined();

    for (const name of ["bootstrap-owner", "email-canary", "google-sign-in"]) {
      expect(result.steps.find((s) => s.name === `canary-flows/${name}`)?.ok, name).toBe(true);
    }
  });

  it("TP-16.16: buildNumber 39 (below minimumBuild 40): 7c fails with web_build_below_minimum and sends no identity request", async () => {
    const { result, requests } = await runStep7(39);

    expect(result.steps.find((s) => s.name === "canary-flows/google-sign-in")).toEqual({
      name: "canary-flows/google-sign-in",
      ok: false,
      detail: "web_build_below_minimum",
    });
    expect(
      requests.filter((r) => r.step === "canary-flows/google-sign-in").filter(identity),
    ).toEqual([]);
    expect(result.ok).toBe(false);
  });
});
