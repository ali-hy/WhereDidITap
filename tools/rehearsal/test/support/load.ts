// Loaders for the rehearsal harness (S-16, `tools/rehearsal/src`), typed from the LLD's
// signatures (F-193 to F-197, A-441 to A-443) so the tests compile before the harness exists.
import type { KeyObject } from "node:crypto";
import type { Canaries } from "@budmon/test-support";

export interface Needle {
  name: string;
  value: string;
}
export interface NeedlesModule {
  REHEARSAL_OWNER_EMAIL: string;
  REHEARSAL_SIGNIN_CLIENT_ID: string;
  REHEARSAL_FX_FAIL_DATE: string;
  REHEARSAL_PORTS: {
    googleTls: number;
    googleControl: number;
    fxTls: number;
    fxControl: number;
    sentryTls: number;
    upgradePg: number;
  };
  REHEARSAL_HOSTS: { fx: string; sentry: string; s3: string };
  REHEARSAL_PUBLIC_ORIGIN: string;
  REHEARSAL_PROJECTS: { main: string; capture: string };
  REHEARSAL_CAPTURE_DB_NETWORK: string;
  scanForNeedles: (
    sources: readonly { name: string; text: string }[],
    needles: readonly Needle[],
  ) => { source: string; needle: string; offset: number }[];
}

export interface Tls {
  key: Buffer;
  cert: Buffer;
}
export interface Closable {
  close(): Promise<void>;
}

export interface SignInKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}
export interface FakeGoogleModule {
  FAKE_SIGNIN_KID: string;
  generateSignInKeyPair: () => SignInKeyPair;
  fakeSignInCode: (nonce: string) => string;
  startFakeGoogle: (opts: {
    tls: Tls;
    port: number;
    controlPort: number;
    canaries: Canaries;
    signInClientId: string;
    signInKeyPair: SignInKeyPair;
  }) => Promise<Closable>;
}

export interface FakeFxModule {
  startFakeFx: (opts: {
    tls: Tls;
    port: number;
    controlPort: number;
    canaries: Canaries;
  }) => Promise<Closable>;
}

export interface SentryCaptureModule {
  startSentryCapture: (port: number, tls?: Tls) => Promise<Closable & { events(): string[] }>;
}

// F-195 (A-442).
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
export interface StepRecord {
  name: string;
  ok: boolean;
  detail: string;
}
export interface StepOutcome {
  ok: boolean;
  detail: string;
  subSteps?: StepRecord[];
}
export interface ExecOptions {
  step: string;
  sensitiveStdout?: boolean;
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
  origin?: string;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}
export type Http = (req: HttpRequest) => Promise<HttpResponse>;
export interface RehearsalServices {
  startFakeGoogle: FakeGoogleModule["startFakeGoogle"];
  startFakeFx: FakeFxModule["startFakeFx"];
  startSentryCapture: SentryCaptureModule["startSentryCapture"];
}
/** A-468: a doctored run's overlay and the step that must fail first. */
export interface RehearsalDoctor {
  name: string;
  project: "main" | "capture";
  file: string;
  expectStep: StepName;
}
export interface RehearsalOptions {
  previousTag: string | null;
  version: string;
  doctor?: RehearsalDoctor | null;
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
  readonly needles: Needle[];
  readonly running: Record<string, unknown>;
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
export interface RunModule {
  STEP_ORDER: readonly StepName[];
  defaultSteps: Readonly<Record<StepName, StepFn>>;
  composeArgs: (
    ctx: Pick<RehearsalContext, "releaseDir"> & { opts?: { doctor?: RehearsalDoctor | null } },
    project: "main" | "capture",
  ) => string[];
  doctorVerdict: (steps: StepRecord[], expectStep: StepName) => { ok: boolean; message: string };
  stageSettingMentions: (info: {
    Env: readonly string[] | null;
    Mounts: readonly { Source: string; Destination: string }[] | null;
  }) => string[];
  runRehearsal: (
    opts: RehearsalOptions,
    deps: RehearsalDeps,
  ) => Promise<{ ok: boolean; steps: StepRecord[] }>;
}

// A-479: the CLI's side-effect-free argument parsing.
export interface ParsedArgs {
  previousTag: string | null;
  version: string;
  doctor: string | null;
  confirmNotLaptop: boolean;
}
export interface ArgsModule {
  USAGE: string;
  parseArgs: (argv: readonly string[]) => { ok: true; args: ParsedArgs } | { ok: false };
  resolveDoctor: (
    repoRoot: string,
    name: string,
    fs?: { exists(p: string): boolean; readFile(p: string): string },
  ) => { ok: true; doctor: RehearsalDoctor } | { ok: false; message: string };
}

// A-478: the laptop-safety guard.
export interface GuardModule {
  LAPTOP_PROJECTS: readonly string[];
  LAPTOP_CAPTURE_DB_NETWORK: string;
  checkRehearsalHost: (f: {
    env: Readonly<Record<string, string | undefined>>;
    homeDir: string;
    confirmNotLaptop: boolean;
    exists(path: string): boolean;
  }) => { ok: true } | { ok: false; reason: string };
  checkNoLaptopStack: (exec: Exec) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

// A-476: the per-step logging exec.
export interface ExecModule {
  createLoggingExec: (
    logDir: string,
    deps?: { spawn?: typeof import("node:child_process").spawn },
  ) => Exec;
}

async function load<T>(spec: string): Promise<T> {
  return (await import(/* @vite-ignore */ spec)) as T;
}

export const loadNeedles = () => load<NeedlesModule>("../../src/needles.ts");
export const loadFakeGoogle = () => load<FakeGoogleModule>("../../src/fakeGoogle.ts");
export const loadFakeFx = () => load<FakeFxModule>("../../src/fakeFx.ts");
export const loadRun = () => load<RunModule>("../../src/run.ts");
export const loadArgs = () => load<ArgsModule>("../../src/args.ts");
export const loadGuard = () => load<GuardModule>("../../src/guard.ts");
export const loadExec = () => load<ExecModule>("../../src/exec.ts");
