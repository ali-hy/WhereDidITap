// F-175's environment per service, through F-11: the laptop's Compose files resolve to a valid
// production configuration for every application service. TP-15.27.
//
// `docker compose config --format json` of both laptop files with local.env, a complete site.env
// (throwaway values in valid shapes) and BUDMON_TAG=v1.0.0. Secret directories hold F-191's files
// with placeholders filled (values in valid shapes, built here; budmonctl isn't needed). Each
// service's /run/secrets/<KEY> paths are pointed at its directory, and its resolved environment goes
// through loadConfig for its kind.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../../src/platform/config/loadConfig.js";
import { base64Bytes, keyRing, rsaKeyPair } from "../../support/configEnv.js";
import { SERVER_DIR } from "../../support/platform.js";

const ROOT = path.resolve(SERVER_DIR, "../..");
const LOCAL = path.join(ROOT, "infra/local");

const SITE: Readonly<Record<string, string>> = {
  PUBLIC_ORIGIN: "https://laptop.tailnet.ts.net",
  CAPTURE_KEY_VERSION:
    "projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1",
  GOOGLE_OAUTH_CLIENT_ID: "123-oauth.apps.googleusercontent.com",
  S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
  S3_REGION: "eu-central-003",
  S3_BUCKET_EXPORTS: "budmon-exports",
  S3_BUCKET_ERASURE_LOG: "budmon-erasure-log",
  SENTRY_DSN: "https://k@o1.ingest.sentry.io/1",
  GOOGLE_SIGNIN_CLIENT_ID: "123-signin.apps.googleusercontent.com",
  GOOGLE_SIGNIN_ANDROID_CLIENT_IDS: "",
  GOOGLE_SIGNIN_CALLBACK_ORIGIN: "http://localhost:8080",
  GOOGLE_SIGNIN_APP_ORIGINS: "https://laptop.tailnet.ts.net,http://localhost:8080",
  SMTP_URL: "smtp://mailpit:1025",
  EMAIL_FROM: "Budmon <no-reply@budmon.local>",
};

const VERIFIER =
  "SCRAM-SHA-256$4096:c2FsdHNhbHRzYWx0c2FsdA==$c3RvcmVka2V5c3RvcmVka2V5c3RvcmVka2V5c3RvcmU=:c2VydmVya2V5c2VydmVya2V5c2VydmVya2V5c2VydmU=";
const PEM_CERT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

/** F-191's files (placeholders filled) plus the TLS/CA files F-178 adds, per service directory. */
function secretFiles(): Record<string, Record<string, string>> {
  const pub = rsaKeyPair().publicPem;
  return {
    "main/api": {
      DB_PASSWORD: "app-password",
      CURSOR_KEY: base64Bytes(32),
      RATE_LIMIT_HMAC_KEY: base64Bytes(32),
      API_SECRETS_KEYS: keyRing(),
      RECOVERY_CODE_HMAC_KEYS: keyRing(),
      S3_ACCESS_KEY_ID: "access-key-id",
      S3_SECRET_ACCESS_KEY: "secret-access-key",
      CAPTURE_PUBLIC_KEY: pub,
      GOOGLE_SIGNIN_CLIENT_SECRET: "signin-secret",
    },
    "main/worker-general": {
      DB_PASSWORD: "app-password",
      QUEUE_DB_PASSWORD: "queue-password",
      SMTP_PASSWORD: "",
      S3_ACCESS_KEY_ID: "access-key-id",
      S3_SECRET_ACCESS_KEY: "secret-access-key",
      FX_PRIMARY_APP_ID: "oxr-app-id",
      CAPTURE_PUBLIC_KEY: pub,
    },
    "main/migrate": {
      DB_PASSWORD: "migrator-password",
      ROLE_SECRETS: JSON.stringify(
        Object.fromEntries(
          ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"].map(
            (r) => [r, { verifier: VERIFIER }],
          ),
        ),
      ),
    },
    "main/postgres": {
      ADMIN_PASSWORD: "admin",
      MIGRATOR_VERIFIER: VERIFIER,
      TLS_KEY: "k",
      TLS_CERT: PEM_CERT,
    },
    "capture/worker-capture": {
      DB_PASSWORD: "capture-password",
      MAILBOX_HMAC_KEY: base64Bytes(32),
      DB_CA_CERT: PEM_CERT,
      GCP_CREDENTIALS: JSON.stringify({ type: "service_account", project_id: "p" }),
      GOOGLE_OAUTH_CLIENT_SECRET: "oauth-secret",
      CAPTURE_PUBLIC_KEY: pub,
    },
  };
}

const SERVICES = {
  api: { project: "main", kind: "api", dir: "main/api" },
  "worker-general": { project: "main", kind: "worker", dir: "main/worker-general" },
  migrate: { project: "main", kind: "migrate", dir: "main/migrate" },
  "worker-capture": { project: "capture", kind: "worker", dir: "capture/worker-capture" },
} as const;
type ServiceName = keyof typeof SERVICES;

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "budmon-laptop-env-"));
  for (const [dir, files] of Object.entries(secretFiles())) {
    mkdirSync(path.join(home, "secrets", dir), { recursive: true });
    for (const [name, value] of Object.entries(files)) {
      writeFileSync(path.join(home, "secrets", dir, name), value);
    }
  }
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function writeSite(without?: string): void {
  const lines = Object.entries(SITE)
    .filter(([k]) => k !== without)
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(path.join(home, "site.env"), `${lines.join("\n")}\n`, { mode: 0o600 });
}

/** Resolved environments of the four application services, or the compose failure. */
function resolve(env: Record<string, string | undefined> = { BUDMON_TAG: "v1.0.0" }) {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, BUDMON_HOME: home, ...env })) {
    if (typeof v === "string") merged[k] = v;
  }
  const out: Partial<Record<ServiceName, Record<string, string>>> = {};
  for (const project of ["main", "capture"] as const) {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        LOCAL,
        "-f",
        path.join(LOCAL, `compose.${project}.yaml`),
        "--env-file",
        path.join(LOCAL, "local.env"),
        "--profile",
        "tools",
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", env: merged },
    );
    if (result.status !== 0) return { ok: false as const, stderr: result.stderr };
    const cfg = JSON.parse(result.stdout) as {
      services?: Record<string, { environment?: Record<string, string | null> }>;
    };
    for (const [name, meta] of Object.entries(SERVICES)) {
      if (meta.project !== project) continue;
      const e = cfg.services?.[name]?.environment ?? {};
      out[name as ServiceName] = Object.fromEntries(
        Object.entries(e).map(([k, v]) => [k, v ?? ""]),
      );
    }
  }
  return { ok: true as const, envs: out };
}

/** loadConfig's problems for one service, its /run/secrets paths pointed at its directory. */
function problemsFor(name: ServiceName, env: Record<string, string>) {
  const meta = SERVICES[name];
  const dir = path.join(home, "secrets", meta.dir);
  const mapped = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      v.startsWith("/run/secrets/") ? path.join(dir, v.slice("/run/secrets/".length)) : v,
    ]),
  );
  try {
    const config = loadConfig(meta.kind, mapped, (p: string) => readFileSync(p));
    return { problems: [] as { variable: string; rule: string }[], config };
  } catch (e) {
    if (e instanceof ConfigError) return { problems: [...e.problems], config: null };
    throw e;
  }
}

describe("TP-15.27: the laptop environment is a valid production configuration (F-175, F-11)", () => {
  it("TP-15.27: every application service loads with no problems, release v1.0.0, appEnv production", () => {
    writeSite();
    const r = resolve();
    expect(r.ok, r.ok ? "" : r.stderr).toBe(true);
    if (!r.ok) return;

    for (const name of Object.keys(SERVICES) as ServiceName[]) {
      const env = r.envs[name];
      expect(env, name).toBeDefined();
      const { problems, config } = problemsFor(name, env ?? {});
      expect(problems, name).toEqual([]);
      expect(config?.release, name).toBe("v1.0.0");
      expect(config?.appEnv, name).toBe("production");
    }
  });

  it("TP-15.27: worker-general's resolved PUBLIC_ORIGIN equals api's", () => {
    writeSite();
    const r = resolve();
    if (!r.ok) throw new Error(r.stderr);

    expect(r.envs["worker-general"]?.["PUBLIC_ORIGIN"]).toBe(r.envs.api?.["PUBLIC_ORIGIN"]);
    expect(r.envs.api?.["PUBLIC_ORIGIN"]).toBe(SITE["PUBLIC_ORIGIN"]);
  });

  const NEEDED: readonly (readonly [string, readonly ServiceName[]])[] = [
    ["PUBLIC_ORIGIN", ["api", "worker-general"]],
    ["S3_ENDPOINT", ["api", "worker-general"]],
    ["S3_REGION", ["api", "worker-general"]],
    ["S3_BUCKET_EXPORTS", ["api", "worker-general"]],
    ["S3_BUCKET_ERASURE_LOG", ["api", "worker-general"]],
    ["CAPTURE_KEY_VERSION", ["api", "worker-general", "worker-capture"]],
    ["GOOGLE_OAUTH_CLIENT_ID", ["worker-capture"]],
    ["GOOGLE_SIGNIN_CLIENT_ID", ["api"]],
    ["SMTP_URL", ["worker-general"]],
    ["EMAIL_FROM", ["worker-general"]],
    ["GOOGLE_SIGNIN_CALLBACK_ORIGIN", ["api"]],
    ["SENTRY_DSN", []],
  ];

  it.each(NEEDED)(
    "TP-15.27: site.env without %s yields a problem naming it exactly for %j",
    (key, services) => {
      writeSite(key);
      const r = resolve();
      if (!r.ok) throw new Error(r.stderr);

      const with_ = (Object.keys(SERVICES) as ServiceName[]).filter((name) =>
        problemsFor(name, r.envs[name] ?? {}).problems.some((p) => p.variable === key),
      );
      expect(with_.sort()).toEqual([...services].sort());
    },
  );

  it("TP-15.27: an unset BUDMON_TAG makes compose config fail", () => {
    writeSite();

    expect(resolve({ BUDMON_TAG: undefined }).ok).toBe(false);
  });
});
