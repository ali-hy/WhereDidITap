// Environments and secret files for loadConfig tests (F-10, F-11; TP-2.1 to TP-2.5, TP-2.21 to
// TP-2.23). Each builder returns a valid environment for one process kind; tests change one
// variable at a time. Files live in an in-memory map read through loadConfig's injected readFile.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { ProcessKind } from "../../src/platform/config/schema.js";

export type Env = Record<string, string | undefined>;
export type Files = Map<string, string>;

export interface Fixture {
  kind: ProcessKind;
  env: Env;
  files: Files;
}

let rsaKeys: { publicPem: string; privatePem: string } | undefined;

/** One RSA-3072 key pair per test file (generation takes about a second). */
export function rsaKeyPair(): { publicPem: string; privatePem: string } {
  rsaKeys ??= (() => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    return {
      publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  })();
  return rsaKeys;
}

export function base64Bytes(length: number): string {
  return randomBytes(length).toString("base64");
}

export function keyRing(current = "k1", ids: readonly string[] = ["k1"]): string {
  return JSON.stringify({
    current,
    keys: Object.fromEntries(ids.map((id) => [id, base64Bytes(32)])),
  });
}

/** A readFile for loadConfig: returns the file's content, throws ENOENT for unknown paths. */
export function readFileFrom(files: Files): (path: string) => Buffer {
  return (path: string) => {
    const content = files.get(path);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: "ENOENT",
      });
    }
    return Buffer.from(content, "utf8");
  };
}

/** Sets `variable` to a new file path holding `content`. */
export function withFile(fixture: Fixture, variable: string, content: string): void {
  const path = `/secrets/${variable.toLowerCase()}`;
  fixture.files.set(path, content);
  fixture.env[variable] = path;
}

function roleSecretsJson(form: "password" | "verifier"): string {
  const roles = [
    "budmon_app",
    "budmon_capture",
    "budmon_queue",
    "budmon_monitor",
    "budmon_migrator",
  ];
  const verifier =
    "SCRAM-SHA-256$4096:c2FsdHNhbHRzYWx0c2FsdA==$c3RvcmVka2V5c3RvcmVka2V5c3RvcmVka2V5c3RvcmU=:c2VydmVya2V5c2VydmVya2V5c2VydmVya2V5c2VydmU=";
  return JSON.stringify(
    Object.fromEntries(
      roles.map((r) => [r, form === "password" ? { password: `pw-${r}` } : { verifier }]),
    ),
  );
}

function base(kind: ProcessKind, appEnv: string): Fixture {
  const fixture: Fixture = {
    kind,
    env: {
      APP_ENV: appEnv,
      DB_HOST: "localhost",
      DB_NAME: "budmon",
      DB_USER: kind === "migrate" ? "budmon_migrator" : "budmon_app",
    },
    files: new Map(),
  };
  withFile(fixture, "DB_PASSWORD_FILE", "db-password\n");
  if (appEnv === "production" || appEnv === "rehearsal") {
    fixture.env["BUDMON_RELEASE"] = "v1.2.3";
  }
  return fixture;
}

// ---- development ----

export function devApi(): Fixture {
  const f = base("api", "development");
  Object.assign(f.env, {
    PUBLIC_ORIGIN: "http://localhost:5173",
    CAPTURE_KEY_VERSION: "local:1",
    OBJECT_STORE_KIND: "fs",
    OBJECT_STORE_FS_ROOT: ".data/objects",
  });
  withFile(f, "CURSOR_KEY_FILE", base64Bytes(32));
  withFile(f, "RATE_LIMIT_HMAC_KEY_FILE", base64Bytes(32));
  withFile(f, "API_SECRETS_KEYS_FILE", keyRing());
  withFile(f, "RECOVERY_CODE_HMAC_KEYS_FILE", keyRing());
  withFile(f, "CAPTURE_PUBLIC_KEY_FILE", rsaKeyPair().publicPem);
  withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", base64Bytes(32));
  return f;
}

export function devWorker(): Fixture {
  const f = base("worker", "development");
  Object.assign(f.env, {
    WORKER_ROLES: "capture,general",
    QUEUE_DB_USER: "budmon_queue",
    CAPTURE_KEY_VERSION: "local:1",
    KMS_PROVIDER: "local",
    FX_PROVIDER: "fixed",
    OBJECT_STORE_KIND: "fs",
    OBJECT_STORE_FS_ROOT: ".data/objects",
    PUBLIC_ORIGIN: "http://localhost:5173",
    SMTP_URL: "smtp://localhost:1025",
    EMAIL_FROM: "Budmon <no-reply@budmon.local>",
  });
  withFile(f, "QUEUE_DB_PASSWORD_FILE", "queue-password\n");
  withFile(f, "CAPTURE_PUBLIC_KEY_FILE", rsaKeyPair().publicPem);
  withFile(f, "CAPTURE_PRIVATE_KEY_FILE", rsaKeyPair().privatePem);
  withFile(f, "MAILBOX_HMAC_KEY_FILE", base64Bytes(32));
  return f;
}

export function devMigrate(): Fixture {
  const f = base("migrate", "development");
  withFile(f, "ROLE_SECRETS_FILE", roleSecretsJson("password"));
  return f;
}

// ---- production ----

export function prodApi(appEnv: "production" | "rehearsal" = "production"): Fixture {
  const f = base("api", appEnv);
  Object.assign(f.env, {
    PUBLIC_ORIGIN: "https://a.ts.net",
    TRUSTED_PROXY: "172.30.0.2",
    CAPTURE_KEY_VERSION:
      "projects/p/locations/europe-west1/keyRings/r/cryptoKeys/capture/cryptoKeyVersions/1",
    OBJECT_STORE_KIND: "s3",
    S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
    S3_REGION: "eu-central-003",
    S3_BUCKET_EXPORTS: "budmon-exports",
    S3_BUCKET_ERASURE_LOG: "budmon-erasure-log",
    GOOGLE_SIGNIN_CLIENT_ID: "123.apps.googleusercontent.com",
    GOOGLE_SIGNIN_CALLBACK_ORIGIN: "https://a.ts.net",
    GOOGLE_SIGNIN_APP_ORIGINS: "https://a.ts.net",
  });
  withFile(f, "CURSOR_KEY_FILE", base64Bytes(32));
  withFile(f, "RATE_LIMIT_HMAC_KEY_FILE", base64Bytes(32));
  withFile(f, "API_SECRETS_KEYS_FILE", keyRing());
  withFile(f, "RECOVERY_CODE_HMAC_KEYS_FILE", keyRing());
  withFile(f, "CAPTURE_PUBLIC_KEY_FILE", rsaKeyPair().publicPem);
  withFile(f, "S3_ACCESS_KEY_ID_FILE", "access-key-id");
  withFile(f, "S3_SECRET_ACCESS_KEY_FILE", "secret-access-key");
  withFile(f, "GOOGLE_SIGNIN_CLIENT_SECRET_FILE", "google-signin-secret");
  return f;
}

export function prodWorkerGeneral(appEnv: "production" | "rehearsal" = "production"): Fixture {
  const f = base("worker", appEnv);
  Object.assign(f.env, {
    WORKER_ROLES: "general",
    QUEUE_DB_USER: "budmon_queue",
    CAPTURE_KEY_VERSION:
      "projects/p/locations/europe-west1/keyRings/r/cryptoKeys/capture/cryptoKeyVersions/1",
    FX_PROVIDER: "live",
    OBJECT_STORE_KIND: "s3",
    S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
    S3_REGION: "eu-central-003",
    S3_BUCKET_EXPORTS: "budmon-exports",
    S3_BUCKET_ERASURE_LOG: "budmon-erasure-log",
    PUBLIC_ORIGIN: "https://a.ts.net",
    SMTP_URL: "smtps://u@smtp.example.com",
    EMAIL_FROM: "Budmon <no-reply@budmon.example>",
  });
  withFile(f, "QUEUE_DB_PASSWORD_FILE", "queue-password");
  withFile(f, "CAPTURE_PUBLIC_KEY_FILE", rsaKeyPair().publicPem);
  withFile(f, "FX_PRIMARY_APP_ID_FILE", "oxr-app-id");
  withFile(f, "S3_ACCESS_KEY_ID_FILE", "access-key-id");
  withFile(f, "S3_SECRET_ACCESS_KEY_FILE", "secret-access-key");
  withFile(f, "SMTP_PASSWORD_FILE", "smtp-password");
  return f;
}

export function prodWorkerCapture(appEnv: "production" | "rehearsal" = "production"): Fixture {
  const f = base("worker", appEnv);
  Object.assign(f.env, {
    WORKER_ROLES: "capture",
    DB_USER: "budmon_capture",
    DB_SSLMODE: "verify-full",
    CAPTURE_KEY_VERSION:
      "projects/p/locations/europe-west1/keyRings/r/cryptoKeys/capture/cryptoKeyVersions/1",
    KMS_PROVIDER: "gcp",
    GOOGLE_OAUTH_CLIENT_ID: "456.apps.googleusercontent.com",
    GOOGLE_OAUTH_REDIRECT_ORIGIN: "http://localhost:8080",
  });
  withFile(
    f,
    "DB_SSL_ROOT_CERT_FILE",
    "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
  );
  withFile(f, "CAPTURE_PUBLIC_KEY_FILE", rsaKeyPair().publicPem);
  withFile(f, "GCP_CREDENTIALS_FILE", JSON.stringify({ type: "service_account", project_id: "p" }));
  withFile(f, "GOOGLE_OAUTH_CLIENT_SECRET_FILE", "oauth-client-secret");
  withFile(f, "MAILBOX_HMAC_KEY_FILE", base64Bytes(32));
  return f;
}

export function prodMigrate(): Fixture {
  const f = base("migrate", "production");
  withFile(f, "ROLE_SECRETS_FILE", roleSecretsJson("verifier"));
  return f;
}

export { roleSecretsJson };
