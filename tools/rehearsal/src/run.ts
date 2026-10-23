// F-195: the release rehearsal, stage-0 shape (A-442). It runs the laptop's two Compose projects
// with the rehearsal overlay against fakes for Google, FX and Sentry, and checks privacy, isolation,
// the gate commands, maintenance, rollback and a browser smoke test. Every side effect goes through
// `deps.exec` (child processes), `deps.http` (HTTP) or `deps.services` (the fakes), each call tagged
// with the record name it belongs to, so a unit run can replace any of them.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { scramVerifier } from "../../../infra/budmonctl/src/scram.js";
import { fakeSignInCode, generateSignInKeyPair, startFakeGoogle } from "./fakeGoogle.js";
import { startFakeFx } from "./fakeFx.js";
import {
  REHEARSAL_HOSTS,
  REHEARSAL_OWNER_EMAIL,
  REHEARSAL_PORTS,
  REHEARSAL_SIGNIN_CLIENT_ID,
  scanForNeedles,
  type Needle,
} from "./needles.js";
import { startSentryCapture } from "./sentryCapture.js";

export type StepName =
  | "secrets"
  | "previous-db"
  | "migrate"
  | "stack-up"
  | "ready"
  | "upgrade-assertions"
  | "canary-flows"
  | "scan"
  | "mailpit-quiet"
  | "no-stage-setting"
  | "cross-role-secrets"
  | "gate-commands"
  | "maintenance"
  | "rollback"
  | "smoke";

/** Steps 1 to 14, with 8b as "mailpit-quiet". */
export const STEP_ORDER: readonly StepName[] = Object.freeze([
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
]);

export interface StepRecord {
  name: string;
  ok: boolean;
  detail: string;
}
/** Sub-step names carry no "<step>/" prefix; the runner adds it. */
export interface StepOutcome {
  ok: boolean;
  detail: string;
  subSteps?: StepRecord[];
}
export interface ExecOptions {
  step: string;
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs?: number;
}
export type Exec = (
  cmd: string,
  args: string[],
  o: ExecOptions,
) => Promise<{ code: number; stdout: string }>;
export interface HttpRequest {
  step: string;
  /** Default "http://127.0.0.1:8080". */
  origin?: string;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: string;
}
export type Http = (
  req: HttpRequest,
) => Promise<{ status: number; headers: Record<string, string | string[]>; body: string }>;
export interface RehearsalServices {
  startFakeGoogle: typeof startFakeGoogle;
  startFakeFx: typeof startFakeFx;
  startSentryCapture: typeof startSentryCapture;
}
export interface RunningServices {
  google?: { close(): Promise<void> };
  fx?: { close(): Promise<void> };
  sentry?: { events(): string[]; close(): Promise<void> };
}
export interface RehearsalOptions {
  previousTag: string | null;
  images: { server: string; web: string; postgres: string };
  workDir: string;
  repoRoot: string;
}
export interface RehearsalContext {
  readonly opts: RehearsalOptions;
  readonly exec: Exec;
  readonly http: Http;
  readonly services: RehearsalServices;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly runStart: Date;
  readonly budmonHome: string;
  readonly releaseDir: string;
  /** F-193; appended to by step 7, read by step 8. */
  readonly needles: Needle[];
  /** Set by step 4, closed by cleanup. */
  readonly running: RunningServices;
}
export type StepFn = (ctx: RehearsalContext) => Promise<StepOutcome>;
export interface RehearsalDeps {
  exec: Exec;
  http?: Http;
  steps?: Partial<Record<StepName, StepFn>>;
  services?: RehearsalServices;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  collectArtifacts?: StepFn;
  cleanup?: StepFn;
}

const BASE_ORIGIN = "http://127.0.0.1:8080";
const MAILPIT_ORIGIN = "http://127.0.0.1:8025";
const APP_HOST = "localhost:8080";
const APP_ORIGIN = "http://localhost:8080";
const READY_TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;
const TOKEN = /^bm[a-z]_[A-Za-z0-9_-]{43}$/;
const LINK_TOKEN = /#t=(bm[a-z]_[A-Za-z0-9_-]{43})/g;
const GOOGLE_NAMES = [
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "gmail.googleapis.com",
  "pubsub.googleapis.com",
];
const STAGE_WORDS = /\b(HOST_ROLE|DEPLOYMENT|INFRA_STAGE|STAGE)\b/;

// ---- helpers ----

/** F-178's compose_for plus the overlay. */
export function composeArgs(
  ctx: Pick<RehearsalContext, "releaseDir">,
  project: "main" | "capture",
): string[] {
  const r = ctx.releaseDir;
  return [
    "compose",
    "--project-directory",
    r,
    "-p",
    `budmon-${project}`,
    "-f",
    `${r}/compose.${project}.yaml`,
    "-f",
    `${r}/rehearsal/compose.rehearsal.yaml`,
    "--env-file",
    `${r}/local.env`,
  ];
}

function caDir(ctx: RehearsalContext): string {
  return path.join(ctx.opts.workDir, "ca");
}

function stackEnv(ctx: RehearsalContext, tag = "rehearsal"): Record<string, string> {
  return { BUDMON_HOME: ctx.budmonHome, BUDMON_TAG: tag, REHEARSAL_CA_DIR: caDir(ctx) };
}

/** `docker compose … <args>` for one project. */
function compose(
  ctx: RehearsalContext,
  step: string,
  project: "main" | "capture",
  args: string[],
  extra: { env?: Record<string, string>; input?: string; timeoutMs?: number; tag?: string } = {},
) {
  return ctx.exec("docker", [...composeArgs(ctx, project), ...args], {
    step,
    env: { ...stackEnv(ctx, extra.tag), ...extra.env },
    ...(extra.input === undefined ? {} : { input: extra.input }),
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
}

/** A command with its stderr folded into stdout (for logs and CLI messages). */
function merged(
  ctx: RehearsalContext,
  step: string,
  cmd: string,
  args: string[],
  o: Partial<ExecOptions> = {},
) {
  return ctx.exec("sh", ["-c", '"$@" 2>&1', "sh", cmd, ...args], { step, ...o });
}

/** psql as budmon_admin over the Postgres socket (peer authentication), the statement on stdin. */
function adminSql(ctx: RehearsalContext, step: string, sql: string, database = "postgres") {
  return compose(
    ctx,
    step,
    "main",
    [
      "exec",
      "-T",
      "-u",
      "postgres",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-U",
      "budmon_admin",
      "-d",
      database,
      "-At",
    ],
    { input: `${sql}\n` },
  );
}

function ok(detail = ""): StepOutcome {
  return { ok: true, detail };
}
function fail(detail: string): StepOutcome {
  return { ok: false, detail };
}

function header(headers: Record<string, string | string[]>, name: string): string[] {
  const value = headers[name.toLowerCase()];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function json(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function field(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The envelope's error code, or "" (A-33: details name the request, status and error key only). */
function errorCode(body: string): string {
  const code = field(json(body), "code");
  return typeof code === "string" ? code : "";
}

function describeAnswer(request: string, r: { status: number; body: string }): string {
  const code = errorCode(r.body);
  return `${request}: ${String(r.status)}${code === "" ? "" : ` ${code}`}`;
}

function isNotFound(r: { status: number; body: string }): boolean {
  return r.status === 404 && errorCode(r.body) === "NOT_FOUND";
}

/** Polls `probe` every `everyMs` until it returns null (done) or the deadline passes. */
async function poll(
  ctx: RehearsalContext,
  timeoutMs: number,
  everyMs: number,
  probe: () => Promise<string | null>,
): Promise<string | null> {
  const deadline = ctx.now() + timeoutMs;
  for (;;) {
    const pending = await probe();
    if (pending === null) return null;
    if (ctx.now() >= deadline) return pending;
    await ctx.sleep(everyMs);
  }
}

function jsonLines(stdout: string): unknown[] {
  const text = stdout.trim();
  if (text === "") return [];
  if (text.startsWith("[")) {
    const parsed = json(text);
    return Array.isArray(parsed) ? (parsed as unknown[]) : [];
  }
  return text
    .split("\n")
    .map((line) => json(line))
    .filter((v) => v !== undefined);
}

/** The IDs of every container of one Compose project. */
async function containers(ctx: RehearsalContext, step: string, project: "main" | "capture") {
  const r = await ctx.exec(
    "docker",
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=budmon-${project}`],
    { step },
  );
  return r.stdout.split("\n").filter((id) => id.trim() !== "");
}

async function inspect(
  ctx: RehearsalContext,
  step: string,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await ctx.exec("docker", ["inspect", id], { step });
  const parsed = json(r.stdout);
  return Array.isArray(parsed) && typeof parsed[0] === "object" && parsed[0] !== null
    ? (parsed[0] as Record<string, unknown>)
    : {};
}

function serviceOf(info: Record<string, unknown>): string {
  const label = field(info, "Config", "Labels", "com.docker.compose.service");
  return typeof label === "string" ? label : "";
}

/** `/health/ready` through Caddy and both workers' health, polled until all pass (step 5). */
async function waitReady(ctx: RehearsalContext, step: string): Promise<StepOutcome> {
  const pending = await poll(ctx, READY_TIMEOUT_MS, POLL_MS, async () => {
    const ready = await ctx
      .http({ step, method: "GET", path: "/health/ready", headers: { Host: APP_HOST } })
      .catch(() => ({ status: 0, headers: {}, body: "" }));
    if (ready.status !== 200) return "health_ready";
    for (const [project, service] of [
      ["main", "worker-general"],
      ["capture", "worker-capture"],
    ] as const) {
      const ps = await compose(ctx, step, project, ["ps", "--format", "json", service]);
      const health = jsonLines(ps.stdout).map((row) => field(row, "Health"));
      if (ps.code !== 0 || !health.includes("healthy")) return service;
    }
    return null;
  });
  return pending === null ? ok() : fail(`not_ready: ${pending}`);
}

/** Issues a leaf certificate for `names` from the harness CA into <workDir>/ca/<name>.{key,crt}. */
async function leafCertificate(ctx: RehearsalContext, step: string, name: string, names: string[]) {
  const dir = caDir(ctx);
  const key = path.join(dir, `${name}.key`);
  const csr = path.join(dir, `${name}.csr`);
  const crt = path.join(dir, `${name}.crt`);
  const ext = path.join(dir, `${name}.ext`);
  const steps: [string, string[], Partial<ExecOptions>][] = [
    [
      "sh",
      [
        "-c",
        'printf "subjectAltName=%s\\n" "$1" > "$2"',
        "sh",
        names.map((n) => `DNS:${n}`).join(","),
        ext,
      ],
      {},
    ],
    [
      "openssl",
      [
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        `/CN=${names[0] ?? name}`,
        "-keyout",
        key,
        "-out",
        csr,
      ],
      {},
    ],
    [
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        path.join(dir, "ca.crt"),
        "-CAkey",
        path.join(dir, "ca.key"),
        "-CAcreateserial",
        "-days",
        "2",
        "-extfile",
        ext,
        "-out",
        crt,
      ],
      {},
    ],
  ];
  for (const [cmd, args, o] of steps) {
    const r = await ctx.exec(cmd, args, { step, ...o });
    if (r.code !== 0) throw new Error(`certificate ${name}`);
  }
  return { key: readFileSync(key), cert: readFileSync(crt) };
}

/** `budmon-local secret set <rel>` with the value on stdin. */
function secretSet(ctx: RehearsalContext, step: string, rel: string, value: string) {
  return ctx.exec(path.join(ctx.releaseDir, "budmon-local"), ["secret", "set", rel], {
    step,
    env: { BUDMON_HOME: ctx.budmonHome },
    input: value,
  });
}

async function must(
  run: Promise<{ code: number; stdout: string }>,
  what: string,
): Promise<{ code: number; stdout: string }> {
  const r = await run;
  if (r.code !== 0) throw new StepFailure(what);
  return r;
}

/** A step's own failure: its message is a fixed detail, never data. */
class StepFailure extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "StepFailure";
  }
}

async function guarded(run: () => Promise<StepOutcome>): Promise<StepOutcome> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StepFailure) return fail(error.detail);
    throw error;
  }
}

// ---- step 1: secrets ----

/** The throwaway values that replace F-191's placeholders (the capture key pair is per run). */
function placeholderValues(capturePublicPem: string): Record<string, string> {
  return {
    "main/api/S3_ACCESS_KEY_ID": "rehearsal-access-key",
    "main/api/S3_SECRET_ACCESS_KEY": "rehearsal-secret-key",
    "main/api/CAPTURE_PUBLIC_KEY": capturePublicPem,
    "main/api/GOOGLE_SIGNIN_CLIENT_SECRET": "rehearsal-signin-secret",
    "main/worker-general/S3_ACCESS_KEY_ID": "rehearsal-access-key",
    "main/worker-general/S3_SECRET_ACCESS_KEY": "rehearsal-secret-key",
    "main/worker-general/FX_PRIMARY_APP_ID": "rehearsal-oxr-app-id",
    "main/worker-general/CAPTURE_PUBLIC_KEY": capturePublicPem,
    "capture/worker-capture/GCP_CREDENTIALS": JSON.stringify({
      type: "service_account",
      project_id: "rehearsal",
    }),
    "capture/worker-capture/GOOGLE_OAUTH_CLIENT_SECRET": "rehearsal-oauth-secret",
    "capture/worker-capture/CAPTURE_PUBLIC_KEY": capturePublicPem,
  };
}

function siteEnv(): string {
  return [
    "PUBLIC_ORIGIN=https://rehearsal.budmon.invalid",
    "CAPTURE_KEY_VERSION=local:1",
    "GOOGLE_OAUTH_CLIENT_ID=123-rehearsal.apps.googleusercontent.com",
    "S3_ENDPOINT=https://s3.rehearsal.invalid:7070",
    "S3_REGION=us-east-1",
    "S3_BUCKET_EXPORTS=budmon-exports",
    "S3_BUCKET_ERASURE_LOG=budmon-erasure-log",
    `SENTRY_DSN=https://rehearsal@${REHEARSAL_HOSTS.sentry}:${String(REHEARSAL_PORTS.sentryTls)}/1`,
    `GOOGLE_SIGNIN_CLIENT_ID=${REHEARSAL_SIGNIN_CLIENT_ID}`,
    "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS=",
    `GOOGLE_SIGNIN_CALLBACK_ORIGIN=${APP_ORIGIN}`,
    `GOOGLE_SIGNIN_APP_ORIGINS=${APP_ORIGIN}`,
    "SMTP_URL=smtp://mailpit:1025",
    "EMAIL_FROM=Budmon <no-reply@budmon.local>",
    // A-423: so any F-178 build path finds it; no browser sends to it.
    "WEB_SENTRY_DSN=https://rehearsal@sentry.invalid/1",
    "",
  ].join("\n");
}

const secretsStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "secrets";
    const home = ctx.budmonHome;
    const ca = caDir(ctx);
    const x = (cmd: string, args: string[], what: string, o: Partial<ExecOptions> = {}) =>
      must(ctx.exec(cmd, args, { step, ...o }), what);
    await x(
      "mkdir",
      ["-p", "-m", "0700", home, ca, path.join(ctx.opts.workDir, "artifacts")],
      "mkdir",
    );
    await x("chmod", ["0700", home], "mkdir");
    // The candidate's infra/local, copied as F-178 does (the overlay included; tests excluded).
    await x("mkdir", ["-p", path.dirname(ctx.releaseDir)], "release_copy");
    await x(
      "cp",
      ["-a", path.join(ctx.opts.repoRoot, "infra/local"), ctx.releaseDir],
      "release_copy",
    );
    await x("rm", ["-rf", path.join(ctx.releaseDir, "test")], "release_copy");
    const commit = (
      await x("git", ["-C", ctx.opts.repoRoot, "rev-parse", "HEAD"], "release_copy")
    ).stdout.trim();
    await x(
      "install",
      ["-m", "0644", "/dev/stdin", path.join(ctx.releaseDir, "RELEASE")],
      "release_copy",
      {
        input: `tag=rehearsal\ncommit=${commit}\n`,
      },
    );
    // F-191 through its CLI, as install step 4 runs it.
    await x(
      "pnpm",
      [
        "--filter",
        "@budmon/budmonctl",
        "exec",
        "tsx",
        "src/cli.ts",
        "secrets",
        "init-local",
        "--home",
        home,
      ],
      "init_local",
      { cwd: ctx.opts.repoRoot },
    );
    // The private CA and Postgres's certificate, as install step 5 makes them.
    await x(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=Budmon rehearsal CA",
        "-keyout",
        path.join(ca, "ca.key"),
        "-out",
        path.join(ca, "ca.crt"),
      ],
      "ca",
    );
    const pg = await leafCertificate(ctx, step, "postgres", ["db.budmon.internal"]);
    await must(
      secretSet(ctx, step, "main/postgres/TLS_KEY", pg.key.toString("utf8")),
      "secret_set",
    );
    await must(
      secretSet(ctx, step, "main/postgres/TLS_CERT", pg.cert.toString("utf8")),
      "secret_set",
    );
    await must(
      secretSet(
        ctx,
        step,
        "capture/worker-capture/DB_CA_CERT",
        readFileSync(path.join(ca, "ca.crt"), "utf8"),
      ),
      "secret_set",
    );
    // KMS_PROVIDER=local: worker-capture decrypts with this run's private key (CAPTURE_KEY_VERSION
    // local:1); the public half fills the CAPTURE_PUBLIC_KEY placeholders.
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
    await x("install", ["-m", "0644", "/dev/stdin", path.join(ca, "capture.key")], "capture_key", {
      input: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    for (const [rel, value] of Object.entries(placeholderValues(publicPem))) {
      await must(secretSet(ctx, step, rel, value), "secret_set");
    }
    await x("install", ["-m", "0600", "/dev/stdin", path.join(home, "site.env")], "site_env", {
      input: siteEnv(),
    });
    // The owners and modes of the laptop (F-178's apply_secret_ownership).
    await x(
      "bash",
      [
        "-c",
        'set -euo pipefail; source "$1/lib/common.sh"; source "$1/lib/secrets.sh"; apply_secret_ownership',
        "bash",
        ctx.releaseDir,
      ],
      "ownership",
      { env: { BUDMON_HOME: home } },
    );
    // install step 9: the data folders and the capture network.
    await x(
      "sudo",
      ["install", "-d", "-o", "999", "-g", "999", "-m", "0700", path.join(home, "pg")],
      "folders",
    );
    await x("install", ["-d", "-m", "0755", path.join(home, "maintenance")], "folders");
    await x("install", ["-d", "-m", "0700", path.join(home, "dumps")], "folders");
    await x(
      "mkdir",
      [
        "-p",
        path.join(ctx.opts.workDir, "s3/budmon-exports"),
        path.join(ctx.opts.workDir, "s3/budmon-erasure-log"),
      ],
      "folders",
    );
    const subnet =
      readFileSync(path.join(ctx.releaseDir, "local.env"), "utf8").match(
        /^CAPTURE_DB_SUBNET=(.*)$/m,
      )?.[1] ?? "";
    await x(
      "docker",
      ["network", "create", "--internal", "--subnet", subnet, "budmon_capture_db"],
      "network",
    );
    return ok();
  });

// ---- steps 2 and 3: the databases ----

async function waitPostgres(ctx: RehearsalContext, step: string): Promise<boolean> {
  const pending = await poll(ctx, 60_000, 1_000, async () => {
    const r = await compose(ctx, step, "main", [
      "exec",
      "-T",
      "-u",
      "postgres",
      "postgres",
      "pg_isready",
      "-U",
      "budmon_admin",
    ]);
    return r.code === 0 ? null : "postgres";
  });
  return pending === null;
}

/** `migrate` of one release's image (--no-deps: Postgres is already up). */
function runMigrate(ctx: RehearsalContext, step: string, tag: string, extra: string[] = []) {
  return ctx.exec(
    "sh",
    [
      "-c",
      '"$@" 2>&1',
      "sh",
      "docker",
      ...composeArgs(ctx, "main"),
      "--profile",
      "tools",
      "run",
      "--rm",
      "--no-deps",
      ...extra,
      "migrate",
    ],
    { step, env: stackEnv(ctx, tag), timeoutMs: 600_000 },
  );
}

const previousDbStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "previous-db";
    await must(
      compose(ctx, step, "main", ["up", "-d", "postgres"], { env: { BUDMON_FIRST_SETUP: "1" } }),
      "postgres_up",
    );
    if (!(await waitPostgres(ctx, step))) return fail("postgres_not_ready");
    const previous = ctx.opts.previousTag;
    if (previous === null) return ok();
    await must(runMigrate(ctx, step, previous), "previous_migrate");
    return ok();
  });

const migrateStep: StepFn = (ctx) =>
  guarded(async () => {
    await must(runMigrate(ctx, "migrate", "rehearsal"), "migrate_failed");
    return ok();
  });

// ---- step 4: the stack ----

const stackUpStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "stack-up";
    // The fake Google listens on 443 without privileges (A-443).
    await must(
      ctx.exec("sudo", ["sysctl", "-w", "net.ipv4.ip_unprivileged_port_start=443"], { step }),
      "sysctl",
    );
    const google = await leafCertificate(ctx, step, "google", GOOGLE_NAMES);
    const fx = await leafCertificate(ctx, step, "fx", [REHEARSAL_HOSTS.fx]);
    const sentry = await leafCertificate(ctx, step, "sentry", [REHEARSAL_HOSTS.sentry]);
    await leafCertificate(ctx, step, "s3", ["s3.rehearsal.invalid"]);
    // Readable by the containers' users through the read-only mount.
    await must(ctx.exec("chmod", ["-R", "a+rX", caDir(ctx)], { step }), "ca_mode");
    ctx.running.google = await ctx.services.startFakeGoogle({
      tls: google,
      port: REHEARSAL_PORTS.googleTls,
      controlPort: REHEARSAL_PORTS.googleControl,
      canaries: CANARIES,
      signInClientId: REHEARSAL_SIGNIN_CLIENT_ID,
      signInKeyPair: generateSignInKeyPair(),
    });
    ctx.running.fx = await ctx.services.startFakeFx({
      tls: fx,
      port: REHEARSAL_PORTS.fxTls,
      controlPort: REHEARSAL_PORTS.fxControl,
      canaries: CANARIES,
    });
    ctx.running.sentry = await ctx.services.startSentryCapture(REHEARSAL_PORTS.sentryTls, sentry);
    await must(compose(ctx, step, "main", ["up", "-d"], { timeoutMs: 600_000 }), "main_up");
    await must(compose(ctx, step, "capture", ["up", "-d"], { timeoutMs: 600_000 }), "capture_up");
    return ok();
  });

// ---- step 5 ----

const readyStep: StepFn = (ctx) => waitReady(ctx, "ready");

// ---- step 6 ----

// F-183's tests need the candidate's version folder and a database URL the runner can reach; F-195
// names neither for the rehearsal's internal-only Postgres (reported to the planner), so this step
// fails rather than passing unchecked.
const upgradeAssertionsStep: StepFn = () => Promise.resolve(fail("upgrade_assertions_unspecified"));

// ---- step 7: canary flows and the identity sub-steps ----

interface Jar {
  cookies: string[];
}

function post(
  ctx: RehearsalContext,
  step: string,
  urlPath: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.http({
    step,
    method: "POST",
    path: urlPath,
    headers: { Host: APP_HOST, Origin: APP_ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(
  ctx: RehearsalContext,
  step: string,
  urlPath: string,
  headers: Record<string, string> = {},
) {
  return ctx.http({ step, method: "GET", path: urlPath, headers: { Host: APP_HOST, ...headers } });
}

/** Every string anywhere in `value`. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

const SKIPPED = "skipped: identity not built";

/** 7a: the owner's invitation link from the CLI; null when identity isn't built. */
async function bootstrapOwner(
  ctx: RehearsalContext,
): Promise<{ outcome: StepOutcome; token: string | null }> {
  const step = "canary-flows/bootstrap-owner";
  const r = await ctx.exec(
    "docker",
    [
      ...composeArgs(ctx, "main"),
      "exec",
      "-T",
      "api",
      "sh",
      "-c",
      'node dist/main/cli.js identity:bootstrap-owner --email "$1" 2>&1',
      "sh",
      REHEARSAL_OWNER_EMAIL,
    ],
    { step, env: stackEnv(ctx) },
  );
  if (r.stdout.includes("Unknown command:")) return { outcome: ok(SKIPPED), token: null };
  if (r.code !== 0) return { outcome: fail(`bootstrap_owner_exit_${String(r.code)}`), token: null };
  const token = [...r.stdout.matchAll(LINK_TOKEN)][0]?.[1];
  if (token === undefined) return { outcome: fail("bootstrap_token_missing"), token: null };
  ctx.needles.push(
    { name: "bootstrap-token", value: token },
    { name: "owner-email", value: REHEARSAL_OWNER_EMAIL },
  );
  return { outcome: ok(), token };
}

/** 7b: accept, invite the canary address, request a reset, and read both mails from Mailpit. */
async function emailCanary(ctx: RehearsalContext, bootstrapToken: string): Promise<StepOutcome> {
  const step = "canary-flows/email-canary";
  const ownerPassword = randomBytes(24).toString("base64url");
  ctx.needles.push({ name: "owner-password", value: ownerPassword });
  const accept = await post(ctx, step, "/api/v1/invitations/accept", {
    token: bootstrapToken,
    displayName: "Rehearsal Owner",
    locale: "en",
    timeZone: "UTC",
    baseCurrency: "USD",
    method: { kind: "password", password: ownerPassword },
    tokenDelivery: "body",
  });
  if (isNotFound(accept)) return ok(SKIPPED);
  if (accept.status < 200 || accept.status > 299)
    return fail(describeAnswer("invitations_accept", accept));
  const sessionTokens = strings(json(accept.body)).filter((s) => TOKEN.test(s));
  sessionTokens.forEach((value, i) =>
    ctx.needles.push({ name: `session-token-${String(i)}`, value }),
  );
  const access = sessionTokens.find((s) => s.startsWith("bma_"));
  if (access === undefined) return fail("invitations_accept: no access token");
  const invite = await post(
    ctx,
    step,
    "/api/v1/invitations",
    { email: CANARIES.email },
    {
      Authorization: `Bearer ${access}`,
      "Idempotency-Key": randomUUID(),
    },
  );
  if (invite.status !== 201) return fail(describeAnswer("invitations_create", invite));
  const reset = await post(ctx, step, "/api/v1/auth/password-reset/request", {
    email: REHEARSAL_OWNER_EMAIL,
  });
  if (reset.status < 200 || reset.status > 299)
    return fail(describeAnswer("password_reset_request", reset));

  const tokens = new Map<string, string[]>();
  const pending = await poll(ctx, 60_000, POLL_MS, async () => {
    const list = await ctx.http({
      step,
      origin: MAILPIT_ORIGIN,
      method: "GET",
      path: "/api/v1/messages",
      headers: {},
    });
    const messages = field(json(list.body), "messages");
    const rows = Array.isArray(messages) ? (messages as unknown[]) : [];
    for (const [address, kind] of [
      [CANARIES.email, "invite"],
      [REHEARSAL_OWNER_EMAIL, "reset"],
    ] as const) {
      if (tokens.has(kind)) continue;
      const row = rows.find((m) => {
        const to = field(m, "To");
        return Array.isArray(to) && to.some((t) => field(t, "Address") === address);
      });
      const id = field(row, "ID");
      if (typeof id !== "string") continue;
      const message = await ctx.http({
        step,
        origin: MAILPIT_ORIGIN,
        method: "GET",
        path: `/api/v1/message/${encodeURIComponent(id)}`,
        headers: {},
      });
      const parsed = json(message.body);
      const text = [field(parsed, "Text"), field(parsed, "HTML")]
        .filter((v) => typeof v === "string")
        .join("\n");
      tokens.set(
        kind,
        [...text.matchAll(LINK_TOKEN)].map((m) => m[1] ?? ""),
      );
    }
    return tokens.has("invite") && tokens.has("reset") ? null : "mail";
  });
  if (pending !== null) return fail("mail_not_delivered");
  [...(tokens.get("invite") ?? []), ...(tokens.get("reset") ?? [])].forEach((value, i) =>
    ctx.needles.push({ name: `mail-token-${String(i)}`, value }),
  );
  if (!(tokens.get("invite") ?? []).some((t) => t.startsWith("bmi_")))
    return fail("invitation_token_missing");
  if (!(tokens.get("reset") ?? []).some((t) => t.startsWith("bmp_")))
    return fail("reset_token_missing");
  return ok();
}

/** 7c: Google sign-in with the candidate's web client header; the canary address has no user. */
async function googleSignIn(ctx: RehearsalContext): Promise<StepOutcome> {
  const step = "canary-flows/google-sign-in";
  const version = await get(ctx, step, "/version.json");
  const buildNumber = field(json(version.body), "buildNumber");
  if (version.status !== 200 || typeof buildNumber !== "number")
    return fail(describeAnswer("version_json", version));
  const config = await get(ctx, step, "/api/v1/meta/client-config");
  const minimumBuild = field(json(config.body), "web", "minimumBuild");
  if (config.status !== 200 || typeof minimumBuild !== "number")
    return fail(describeAnswer("client_config", config));
  if (buildNumber < minimumBuild) return fail("web_build_below_minimum");
  const client = { "X-Budmon-Client": `web/${String(buildNumber)}` };

  const start = await post(
    ctx,
    step,
    "/api/v1/auth/google/start",
    { intent: "sign_in", returnTo: "/" },
    client,
  );
  if (isNotFound(start)) return ok(SKIPPED);
  const authorizationUrl = field(json(start.body), "authorizationUrl");
  if (start.status !== 200 || typeof authorizationUrl !== "string")
    return fail(describeAnswer("google_start", start));
  const jar: Jar = {
    cookies: header(start.headers, "set-cookie")
      .map((c) => c.split(";")[0] ?? "")
      .filter((c) => c !== ""),
  };
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    return fail("google_start: authorizationUrl");
  }
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  if (state === null || nonce === null) return fail("google_start: state or nonce missing");
  const code = fakeSignInCode(nonce);
  ctx.needles.push({ name: "google-state", value: state }, { name: "google-nonce", value: nonce });

  // As a browser arriving from Google: SameSite=Strict cookies aren't sent.
  const callback = await get(
    ctx,
    step,
    `/api/v1/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    client,
  );
  const location = header(callback.headers, "location")[0] ?? "";
  const handoff = /#h=(bmh_[A-Za-z0-9_-]{43})$/.exec(location)?.[1];
  if (callback.status !== 303 || handoff === undefined)
    return fail(describeAnswer("google_callback", callback));
  ctx.needles.push(
    { name: "google-code", value: code },
    { name: "google-handoff", value: handoff },
  );

  const complete = await post(
    ctx,
    step,
    "/api/v1/auth/google/complete",
    { handoff, tokenDelivery: "cookie" },
    {
      ...client,
      ...(jar.cookies.length === 0 ? {} : { Cookie: jar.cookies.join("; ") }),
    },
  );
  const email = field(json(complete.body), "data", "email");
  if (
    complete.status !== 404 ||
    errorCode(complete.body) !== "GOOGLE_ACCOUNT_UNKNOWN" ||
    email !== CANARIES.email
  ) {
    return fail(describeAnswer("google_complete", complete));
  }
  return ok();
}

const canaryFlowsStep: StepFn = async (ctx) => {
  const flows = await ctx.exec(
    "pnpm",
    ["exec", "vitest", "run", "--config", "vitest.checks.config.ts", "checks/canaryFlows.test.ts"],
    {
      step: "canary-flows",
      cwd: path.join(ctx.opts.repoRoot, "tools/rehearsal"),
      env: {
        ...stackEnv(ctx),
        REHEARSAL_BASE_URL: BASE_ORIGIN,
        REHEARSAL_HOST: APP_HOST,
        REHEARSAL_FX_CONTROL_URL: `http://127.0.0.1:${String(REHEARSAL_PORTS.fxControl)}`,
        REHEARSAL_COMPOSE_MAIN: JSON.stringify(composeArgs(ctx, "main")),
      },
      timeoutMs: 600_000,
    },
  );
  if (flows.code !== 0) return fail("canary_flows_failed");

  const subSteps: StepRecord[] = [];
  const record = (name: string, outcome: StepOutcome) => {
    subSteps.push({ name, ok: outcome.ok, detail: outcome.detail });
    return outcome;
  };
  const a = await bootstrapOwner(ctx);
  record("bootstrap-owner", a.outcome);
  const aSkipped = a.outcome.detail === SKIPPED;
  const b =
    !a.outcome.ok || aSkipped || a.token === null ? ok(SKIPPED) : await emailCanary(ctx, a.token);
  if (a.outcome.ok) record("email-canary", aSkipped ? ok(SKIPPED) : b);
  const bSkipped = aSkipped || b.detail === SKIPPED;
  if (a.outcome.ok && b.ok)
    record("google-sign-in", bSkipped ? ok(SKIPPED) : await googleSignIn(ctx));
  const all = subSteps.every((s) => s.ok);
  return { ok: all, detail: all ? "" : "sub_step_failed", subSteps };
};

// ---- step 8: the scan ----

async function scanSources(
  ctx: RehearsalContext,
  step: string,
): Promise<{ name: string; text: string }[]> {
  const sources: { name: string; text: string }[] = [];
  for (const project of ["main", "capture"] as const) {
    for (const id of await containers(ctx, step, project)) {
      const info = await inspect(ctx, step, id);
      const logs = await merged(ctx, step, "docker", ["logs", id]);
      sources.push({ name: `logs:${project}/${serviceOf(info) || id}`, text: logs.stdout });
    }
  }
  sources.push({ name: "sentry-events", text: (ctx.running.sentry?.events() ?? []).join("\n") });
  const jobs = await adminSql(ctx, step, "SELECT output FROM pgboss.job", "budmon");
  sources.push({ name: "pgboss.job.output", text: jobs.stdout });
  return sources;
}

const scanStep: StepFn = async (ctx) => {
  const sources = await scanSources(ctx, "scan");
  const hits = [
    ...scanForCanaries(sources, CANARIES).map((h) => `${h.source}:${h.canary}`),
    ...scanForNeedles(sources, ctx.needles).map((h) => `${h.source}:${h.needle}`),
  ];
  return hits.length === 0 ? ok() : fail([...new Set(hits)].join(", "));
};

// ---- steps 8b, 9, 10 ----

async function serviceInfo(
  ctx: RehearsalContext,
  step: string,
  project: "main" | "capture",
  service: string,
) {
  for (const id of await containers(ctx, step, project)) {
    const info = await inspect(ctx, step, id);
    if (serviceOf(info) === service) return info;
  }
  return null;
}

const mailpitQuietStep: StepFn = async (ctx) => {
  const step = "mailpit-quiet";
  const info = await serviceInfo(ctx, step, "main", "mailpit");
  if (info === null) return fail("mailpit_missing");
  if (field(info, "HostConfig", "LogConfig", "Type") !== "none") return fail("mailpit_logs");
  const cmd = field(info, "Config", "Cmd");
  if (!Array.isArray(cmd) || !cmd.includes("--quiet")) return fail("mailpit_not_quiet");
  const bindings = field(info, "HostConfig", "PortBindings");
  const published = Object.entries(
    typeof bindings === "object" && bindings !== null ? bindings : {},
  ).flatMap(([port, list]) =>
    (Array.isArray(list) ? (list as unknown[]) : []).map(
      (b) => `${String(field(b, "HostIp"))}:${String(field(b, "HostPort"))}->${port}`,
    ),
  );
  return published.length === 1 && published[0] === "127.0.0.1:8025->8025/tcp"
    ? ok()
    : fail("mailpit_ports");
};

const noStageSettingStep: StepFn = async (ctx) => {
  const step = "no-stage-setting";
  const found: string[] = [];
  for (const project of ["main", "capture"] as const) {
    for (const id of await containers(ctx, step, project)) {
      const info = await inspect(ctx, step, id);
      const env = field(info, "Config", "Env");
      const mounts = field(info, "Mounts");
      const texts = [
        ...(Array.isArray(env) ? env.map(String) : []),
        ...(Array.isArray(mounts)
          ? mounts.flatMap((m) => [String(field(m, "Source")), String(field(m, "Destination"))])
          : []),
      ];
      if (texts.some((t) => STAGE_WORDS.test(t))) found.push(serviceOf(info) || id);
    }
  }
  return found.length === 0 ? ok() : fail(`stage_setting: ${found.join(", ")}`);
};

const crossRoleSecretsStep: StepFn = async (ctx) => {
  const step = "cross-role-secrets";
  const found: string[] = [];
  for (const [project, other] of [
    ["main", "/secrets/capture"],
    ["capture", "/secrets/main"],
  ] as const) {
    for (const id of await containers(ctx, step, project)) {
      const info = await inspect(ctx, step, id);
      const mounts = field(info, "Mounts");
      const sources = Array.isArray(mounts) ? mounts.map((m) => String(field(m, "Source"))) : [];
      if (sources.some((s) => s.includes(other))) found.push(serviceOf(info) || id);
    }
  }
  if (found.length > 0) return fail(`cross_role_mount: ${found.join(", ")}`);
  const pgDataIp =
    /^PG_DATA_IP=(.*)$/m.exec(readFileSync(path.join(ctx.releaseDir, "local.env"), "utf8"))?.[1] ??
    "";
  const probe = await compose(ctx, step, "capture", [
    "exec",
    "-T",
    "worker-capture",
    "node",
    "-e",
    'const s=require("node:net").connect({host:process.argv[1],port:5432,timeout:5000});s.on("connect",()=>{s.destroy();process.exit(0)});s.on("timeout",()=>process.exit(2));s.on("error",()=>process.exit(3));',
    pgDataIp,
  ]);
  return probe.code === 0 ? fail("capture_reaches_data") : ok();
};

// ---- step 11 ----

const gateCommandsStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "gate-commands";
    const env = stackEnv(ctx);
    const cli = (service: string, args: string[], project: "main" | "capture" = "main") =>
      merged(
        ctx,
        step,
        "docker",
        [...composeArgs(ctx, project), "exec", "-T", service, "node", "dist/main/cli.js", ...args],
        { env },
      );
    await must(cli("api", ["secrets:rewrap-api"]), "secrets_rewrap_api");

    // The migrated database, dumped and restored into budmon_restore as F-178 restore steps 5 and 6.
    const dump = path.join(ctx.opts.workDir, "gate.dump");
    await must(
      ctx.exec(
        "sh",
        [
          "-c",
          '"$@" > "$DUMP"',
          "sh",
          "docker",
          ...composeArgs(ctx, "main"),
          "exec",
          "-T",
          "-u",
          "postgres",
          "postgres",
          "pg_dump",
          "-Fc",
          "-U",
          "budmon_admin",
          "budmon",
        ],
        {
          step,
          env: { ...env, DUMP: dump },
        },
      ),
      "pg_dump",
    );
    await must(
      adminSql(ctx, step, "DROP DATABASE IF EXISTS budmon_restore WITH (FORCE)"),
      "restore_drop",
    );
    await must(
      adminSql(ctx, step, "CREATE DATABASE budmon_restore OWNER budmon_migrator"),
      "restore_create",
    );
    await must(
      ctx.exec(
        "sh",
        [
          "-c",
          '"$@" < "$DUMP"',
          "sh",
          "docker",
          ...composeArgs(ctx, "main"),
          "exec",
          "-T",
          "-u",
          "postgres",
          "postgres",
          "pg_restore",
          "--exit-on-error",
          "-U",
          "budmon_admin",
          "-d",
          "budmon_restore",
        ],
        {
          step,
          env: { ...env, DUMP: dump },
        },
      ),
      "pg_restore",
    );
    await must(
      compose(ctx, step, "main", [
        "exec",
        "-T",
        "-u",
        "postgres",
        "postgres",
        "sh",
        "-c",
        'BUDMON_MIGRATOR_PASSWORD="$(cat /run/secrets/MIGRATOR_VERIFIER)" psql -v ON_ERROR_STOP=1 -X -U budmon_admin -d postgres -v dbname=budmon_restore -f /docker-entrypoint-initdb.d/10-budmon.sql.tpl',
      ]),
      "restore_bootstrap",
    );
    await must(
      runMigrate(ctx, step, "rehearsal", ["-e", "DB_NAME=budmon_restore"]),
      "restore_migrate",
    );
    await must(
      merged(
        ctx,
        step,
        "docker",
        [
          ...composeArgs(ctx, "main"),
          "--profile",
          "tools",
          "run",
          "--rm",
          "--no-deps",
          "-e",
          "DB_NAME=budmon_restore",
          "migrate",
          "node",
          "dist/main/cli.js",
          "restore:verify",
        ],
        { env },
      ),
      "restore_verify",
    );
    await must(
      adminSql(ctx, step, "DROP DATABASE IF EXISTS budmon_restore WITH (FORCE)"),
      "restore_drop",
    );
    await must(
      cli("worker-general", ["erasure:replay", "--since", ctx.runStart.toISOString()]),
      "erasure_replay",
    );

    // F-92: a new migrator password, the old one as DB_PASSWORD_PREVIOUS and the new verifier in
    // ROLE_SECRETS; the first migrate logs in through the fallback, the second doesn't need it.
    const migrateDir = path.join(ctx.budmonHome, "secrets/main/migrate");
    const oldPassword = (
      await must(
        ctx.exec("sudo", ["cat", path.join(migrateDir, "DB_PASSWORD")], { step }),
        "read_secret",
      )
    ).stdout;
    const roleSecrets = json(
      (
        await must(
          ctx.exec("sudo", ["cat", path.join(migrateDir, "ROLE_SECRETS")], { step }),
          "read_secret",
        )
      ).stdout,
    );
    if (typeof roleSecrets !== "object" || roleSecrets === null) return fail("role_secrets");
    const newPassword = randomBytes(32).toString("base64url");
    await must(
      ctx.exec(
        "sudo",
        [
          "install",
          "-o",
          "10004",
          "-g",
          "10004",
          "-m",
          "0400",
          "/dev/stdin",
          path.join(migrateDir, "DB_PASSWORD_PREVIOUS"),
        ],
        {
          step,
          input: oldPassword,
        },
      ),
      "write_secret",
    );
    await must(secretSet(ctx, step, "main/migrate/DB_PASSWORD", newPassword), "write_secret");
    await must(
      secretSet(
        ctx,
        step,
        "main/migrate/ROLE_SECRETS",
        JSON.stringify({ ...roleSecrets, budmon_migrator: scramVerifier(newPassword) }),
      ),
      "write_secret",
    );
    const previous = ["-e", "DB_PASSWORD_PREVIOUS_FILE=/run/secrets/DB_PASSWORD_PREVIOUS"];
    const first = await must(runMigrate(ctx, step, "rehearsal", previous), "fallback_migrate");
    if (!first.stdout.includes("migrator_previous_password_used")) return fail("fallback_not_used");
    const second = await must(runMigrate(ctx, step, "rehearsal", previous), "second_migrate");
    if (second.stdout.includes("migrator_previous_password_used"))
      return fail("fallback_used_again");
    return ok();
  });

// ---- step 12 ----

const maintenanceStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "maintenance";
    const flag = (state: "on" | "off") =>
      must(
        ctx.exec(path.join(ctx.releaseDir, "budmon-local"), ["maintenance", state], {
          step,
          env: { BUDMON_HOME: ctx.budmonHome },
        }),
        `maintenance_${state}`,
      );
    await flag("on");
    const config = await get(ctx, step, "/api/v1/meta/client-config");
    if (config.status !== 503 || errorCode(config.body) !== "SERVICE_UNAVAILABLE")
      return fail(describeAnswer("client_config_on", config));
    const ready = await get(ctx, step, "/health/ready");
    if (ready.status !== 503 || field(json(ready.body), "status") !== "maintenance")
      return fail(describeAnswer("health_ready_on", ready));
    await flag("off");
    const after = await get(ctx, step, "/health/ready");
    return after.status === 200 ? ok() : fail(describeAnswer("health_ready_off", after));
  });

// ---- step 13 ----

const rollbackStep: StepFn = (ctx) =>
  guarded(async () => {
    const step = "rollback";
    const previous = ctx.opts.previousTag;
    if (previous === null) return ok("skipped: no previous release");
    // The previous release's images on the migrated database (Postgres keeps running).
    await must(
      compose(ctx, step, "main", ["up", "-d", "--no-deps", "api", "worker-general", "caddy"], {
        tag: previous,
      }),
      "previous_up",
    );
    await must(
      compose(ctx, step, "capture", ["up", "-d", "--no-deps", "worker-capture"], { tag: previous }),
      "previous_up",
    );
    const pending = await poll(ctx, READY_TIMEOUT_MS, POLL_MS, async () => {
      const r = await get(ctx, step, "/health/ready").catch(() => ({
        status: 0,
        headers: {},
        body: "",
      }));
      return r.status === 200 ? null : "health_ready";
    });
    if (pending !== null) return fail("previous_not_ready");
    // A-446: back to the candidate, so step 14 tests it.
    await must(compose(ctx, step, "main", ["up", "-d"]), "candidate_up");
    await must(compose(ctx, step, "capture", ["up", "-d"]), "candidate_up");
    return waitReady(ctx, step);
  });

// ---- step 14 ----

const smokeStep: StepFn = async (ctx) => {
  const r = await ctx.exec(
    "pnpm",
    ["--filter", "@budmon/web", "exec", "playwright", "test", "--project=smoke"],
    {
      step: "smoke",
      cwd: ctx.opts.repoRoot,
      env: { E2E_BASE_URL: APP_ORIGIN, CI: "true" },
      timeoutMs: 600_000,
    },
  );
  return r.code === 0 ? ok() : fail("smoke_failed");
};

export const defaultSteps: Readonly<Record<StepName, StepFn>> = Object.freeze({
  secrets: secretsStep,
  "previous-db": previousDbStep,
  migrate: migrateStep,
  "stack-up": stackUpStep,
  ready: readyStep,
  "upgrade-assertions": upgradeAssertionsStep,
  "canary-flows": canaryFlowsStep,
  scan: scanStep,
  "mailpit-quiet": mailpitQuietStep,
  "no-stage-setting": noStageSettingStep,
  "cross-role-secrets": crossRoleSecretsStep,
  "gate-commands": gateCommandsStep,
  maintenance: maintenanceStep,
  rollback: rollbackStep,
  smoke: smokeStep,
});

// ---- artifacts and cleanup ----

const defaultCollectArtifacts: StepFn = async (ctx) => {
  const step = "artifacts";
  const dir = path.join(ctx.opts.workDir, "artifacts");
  const save = (name: string, text: string) =>
    ctx.exec("install", ["-D", "-m", "0644", "/dev/stdin", path.join(dir, name)], {
      step,
      input: text,
    });
  await ctx.exec("mkdir", ["-p", dir], { step });
  const sources = await scanSources(ctx, step).catch(() => []);
  for (const source of sources) {
    await save(`${source.name.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.log`, source.text);
  }
  // Names only: the scan report never holds a value.
  const report = {
    canaries: scanForCanaries(sources, CANARIES).map((h) => ({
      source: h.source,
      canary: h.canary,
    })),
    needles: scanForNeedles(sources, ctx.needles).map((h) => ({
      source: h.source,
      needle: h.needle,
    })),
  };
  await save("scan-report.json", `${JSON.stringify(report, null, 2)}\n`);
  return ok();
};

const defaultCleanup: StepFn = async (ctx) => {
  const step = "cleanup";
  const failures: string[] = [];
  for (const [name, service] of Object.entries(ctx.running)) {
    try {
      await (service as { close(): Promise<void> }).close();
    } catch {
      failures.push(name);
    }
  }
  for (const project of ["capture", "main"] as const) {
    const r = await compose(ctx, step, project, [
      "--profile",
      "tools",
      "down",
      "-v",
      "--remove-orphans",
    ]);
    if (r.code !== 0) failures.push(`down_${project}`);
  }
  await ctx.exec("docker", ["network", "rm", "budmon_capture_db"], { step });
  const rm = await ctx.exec("sudo", ["rm", "-rf", ctx.budmonHome], { step });
  if (rm.code !== 0) failures.push("home");
  return failures.length === 0 ? ok() : fail(`cleanup: ${failures.join(", ")}`);
};

// ---- the runner ----

const defaultHttp: Http = (req) =>
  new Promise((resolve, reject) => {
    const origin = new URL(req.origin ?? BASE_ORIGIN);
    const r = httpRequest(
      {
        host: origin.hostname,
        port: origin.port === "" ? 80 : Number.parseInt(origin.port, 10),
        method: req.method,
        path: req.path,
        headers: req.headers,
        timeout: 30_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          const headers: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = v;
          resolve({ status: res.statusCode ?? 0, headers, body });
        });
      },
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    r.end(req.body);
  });

const defaultServices: RehearsalServices = { startFakeGoogle, startFakeFx, startSentryCapture };

function errorDetail(error: unknown): string {
  return `error: ${error instanceof Error ? error.name : "unknown"}`;
}

async function attempt(fn: StepFn, ctx: RehearsalContext): Promise<StepOutcome> {
  try {
    return await fn(ctx);
  } catch (error) {
    return { ok: false, detail: errorDetail(error) };
  }
}

export async function runRehearsal(
  opts: RehearsalOptions,
  deps: RehearsalDeps,
): Promise<{ ok: boolean; steps: StepRecord[] }> {
  const now = deps.now ?? Date.now;
  const budmonHome = path.join(opts.workDir, "home");
  const ctx: RehearsalContext = {
    opts,
    exec: deps.exec,
    http: deps.http ?? defaultHttp,
    services: deps.services ?? defaultServices,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now,
    runStart: new Date(now()),
    budmonHome,
    releaseDir: path.join(budmonHome, "releases", "rehearsal"),
    needles: [],
    running: {},
  };
  const steps: StepRecord[] = [];
  for (const name of STEP_ORDER) {
    if (opts.previousTag === null && (name === "upgrade-assertions" || name === "rollback")) {
      steps.push({ name, ok: true, detail: "skipped: no previous release" });
      continue;
    }
    const outcome = await attempt(deps.steps?.[name] ?? defaultSteps[name], ctx);
    steps.push({ name, ok: outcome.ok, detail: outcome.detail });
    for (const sub of outcome.subSteps ?? []) {
      steps.push({ name: `${name}/${sub.name}`, ok: sub.ok, detail: sub.detail });
    }
    if (!outcome.ok) break;
  }
  for (const [name, fn] of [
    ["artifacts", deps.collectArtifacts ?? defaultCollectArtifacts],
    ["cleanup", deps.cleanup ?? defaultCleanup],
  ] as const) {
    const outcome = await attempt(fn, ctx);
    steps.push({ name, ok: outcome.ok, detail: outcome.detail });
  }
  return { ok: steps.every((s) => s.ok), steps };
}
