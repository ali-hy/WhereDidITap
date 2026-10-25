// F-10: the configuration schema. `parseConfig` validates one process kind's environment (with
// every `*_FILE` already read) and reports one problem per failing variable, never a value.
import { createPublicKey } from "node:crypto";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { Secret } from "../observability/redaction.js";

export type ProcessKind = "api" | "worker" | "migrate";
export type AppEnv = "development" | "test" | "rehearsal" | "production";
export type DbLoginRole =
  "budmon_app" | "budmon_capture" | "budmon_queue" | "budmon_monitor" | "budmon_migrator";
export type WorkerRole = "capture" | "general";
type KeyRing = Secret<{ current: string; keys: Map<string, Buffer> }>;

export interface Config {
  kind: ProcessKind;
  appEnv: AppEnv;
  logLevel: "debug" | "info" | "warn" | "error";
  release: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: Secret<string>;
    sslmode: "disable" | "verify-full";
    sslRootCert?: Buffer;
    poolMax: number;
  };
  worker?: {
    roles: ReadonlySet<WorkerRole>;
    queue?: { user: string; password: Secret<string>; poolMax: number };
  };
  migrate?: {
    roleSecrets: Record<DbLoginRole, { verifier: string } | { password: Secret<string> }>;
    previousPassword?: Secret<string>;
  };
  api?: {
    port: number;
    host: string;
    publicOrigin: URL;
    googleOAuthRedirectOrigin: URL;
    trustedProxy: string[];
    clientVersions: {
      minAndroid: number;
      latestAndroid: number;
      minWeb: number;
      androidDownloadUrl?: URL;
    };
    cursorKey: Secret<Buffer>;
    rateLimitKey: Secret<Buffer>;
    apiSecretsKeys: KeyRing;
    devObjectsKey?: Secret<Buffer>;
    googleSignIn?: {
      clientId: string;
      clientSecret: Secret<string>;
      androidClientIds: string[];
      callbackOrigin: URL;
      appOrigins: URL[];
    };
    recoveryCodeKeys: KeyRing;
  };
  email?: {
    smtpUrl: URL;
    smtpTransport: {
      security: "implicit_tls" | "starttls" | "none";
      host: string;
      port: number;
      user?: string;
    };
    smtpPassword?: Secret<string>;
    from: string;
    publicOrigin: URL;
  };
  capture?: {
    publicKeyPem: string;
    keyVersion: string;
    kms:
      | { provider: "gcp"; credentials: Secret<object> }
      | { provider: "local"; privateKeyPem: Secret<string> };
    oauth?: { clientId: string; clientSecret: Secret<string>; redirectOrigin: URL };
    mailboxHmacKey: Secret<Buffer>;
  };
  sealing?: { publicKeyPem: string; keyVersion: string };
  fx?:
    | {
        provider: "live";
        primaryAppId: Secret<string>;
        primaryBaseUrl: URL;
        fallbackBaseUrl: string;
        fallbackMirrorUrl: string;
      }
    | { provider: "fixed" };
  objectStore?:
    | { kind: "fs"; root: string }
    | {
        kind: "s3";
        endpoint: URL;
        region: string;
        buckets: { exports: string; erasureLog: string };
        accessKeyId: Secret<string>;
        secretAccessKey: Secret<string>;
      };
  otlpEndpoint?: URL;
  otlpHeaders?: Secret<Record<string, string>>;
  sentryDsn?: string;
}

const ALL_KEYS = [
  "ANDROID_DOWNLOAD_URL",
  "API_SECRETS_KEYS_FILE",
  "APP_ENV",
  "BUDMON_RELEASE",
  "CAPTURE_KEY_VERSION",
  "CAPTURE_PRIVATE_KEY_FILE",
  "CAPTURE_PUBLIC_KEY_FILE",
  "CLIENT_LATEST_ANDROID",
  "CLIENT_MIN_ANDROID",
  "CLIENT_MIN_WEB",
  "CURSOR_KEY_FILE",
  "DB_HOST",
  "DB_NAME",
  "DB_PASSWORD_FILE",
  "DB_PASSWORD_PREVIOUS_FILE",
  "DB_POOL_MAX",
  "DB_PORT",
  "DB_SSLMODE",
  "DB_SSL_ROOT_CERT_FILE",
  "DB_USER",
  "DEV_OBJECTS_SIGNING_KEY_FILE",
  "DEV_SUPERUSER_URL",
  "EMAIL_FROM",
  "FX_FALLBACK_BASE_URL",
  "FX_FALLBACK_MIRROR_URL",
  "FX_PRIMARY_APP_ID_FILE",
  "FX_PRIMARY_BASE_URL",
  "FX_PROVIDER",
  "GCP_CREDENTIALS_FILE",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET_FILE",
  "GOOGLE_OAUTH_REDIRECT_ORIGIN",
  "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS",
  "GOOGLE_SIGNIN_APP_ORIGINS",
  "GOOGLE_SIGNIN_CALLBACK_ORIGIN",
  "GOOGLE_SIGNIN_CLIENT_ID",
  "GOOGLE_SIGNIN_CLIENT_SECRET_FILE",
  "HEARTBEAT_FILE",
  "HOST",
  "KMS_PROVIDER",
  "LOG_LEVEL",
  "MAILBOX_HMAC_KEY_FILE",
  "OBJECT_STORE_FS_ROOT",
  "OBJECT_STORE_KIND",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_HEADERS_FILE",
  "PORT",
  "PUBLIC_ORIGIN",
  "QUEUE_DB_PASSWORD_FILE",
  "QUEUE_DB_USER",
  "QUEUE_POOL_MAX",
  "RATE_LIMIT_HMAC_KEY_FILE",
  "RECOVERY_CODE_HMAC_KEYS_FILE",
  "ROLE_SECRETS_FILE",
  "S3_ACCESS_KEY_ID_FILE",
  "S3_BUCKET_ERASURE_LOG",
  "S3_BUCKET_EXPORTS",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY_FILE",
  "SENTRY_DSN",
  "SMTP_PASSWORD_FILE",
  "SMTP_URL",
  "TRUSTED_PROXY",
  "WORKER_ROLES",
] as const;

const COMMON_KEYS = [
  "APP_ENV",
  "LOG_LEVEL",
  "BUDMON_RELEASE",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_HEADERS_FILE",
  "SENTRY_DSN",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PORT",
  "DB_PASSWORD_FILE",
  "DB_SSLMODE",
  "DB_SSL_ROOT_CERT_FILE",
  "DB_POOL_MAX",
];
const SEALING_KEYS = ["CAPTURE_PUBLIC_KEY_FILE", "CAPTURE_KEY_VERSION"];
const OBJECT_STORE_KEYS = [
  "OBJECT_STORE_KIND",
  "OBJECT_STORE_FS_ROOT",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET_EXPORTS",
  "S3_BUCKET_ERASURE_LOG",
  "S3_ACCESS_KEY_ID_FILE",
  "S3_SECRET_ACCESS_KEY_FILE",
];
const KIND_KEYS: Readonly<Record<"migrate" | "api", readonly string[]>> = {
  migrate: ["ROLE_SECRETS_FILE", "DB_PASSWORD_PREVIOUS_FILE"],
  api: [
    "PORT",
    "HOST",
    "PUBLIC_ORIGIN",
    "GOOGLE_OAUTH_REDIRECT_ORIGIN",
    "TRUSTED_PROXY",
    "CLIENT_MIN_ANDROID",
    "CLIENT_LATEST_ANDROID",
    "CLIENT_MIN_WEB",
    "ANDROID_DOWNLOAD_URL",
    "CURSOR_KEY_FILE",
    "RATE_LIMIT_HMAC_KEY_FILE",
    "API_SECRETS_KEYS_FILE",
    "RECOVERY_CODE_HMAC_KEYS_FILE",
    "DEV_OBJECTS_SIGNING_KEY_FILE",
    "GOOGLE_SIGNIN_CLIENT_ID",
    "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS",
    "GOOGLE_SIGNIN_CLIENT_SECRET_FILE",
    "GOOGLE_SIGNIN_CALLBACK_ORIGIN",
    "GOOGLE_SIGNIN_APP_ORIGINS",
    ...SEALING_KEYS,
    ...OBJECT_STORE_KEYS,
  ],
};
const ROLE_KEYS: Readonly<Record<WorkerRole, readonly string[]>> = {
  general: [
    "QUEUE_DB_USER",
    "QUEUE_DB_PASSWORD_FILE",
    "QUEUE_POOL_MAX",
    "PUBLIC_ORIGIN",
    "SMTP_URL",
    "EMAIL_FROM",
    "SMTP_PASSWORD_FILE",
    "FX_PROVIDER",
    "FX_PRIMARY_APP_ID_FILE",
    "FX_PRIMARY_BASE_URL",
    "FX_FALLBACK_BASE_URL",
    "FX_FALLBACK_MIRROR_URL",
    ...OBJECT_STORE_KEYS,
  ],
  capture: [
    "KMS_PROVIDER",
    "GCP_CREDENTIALS_FILE",
    "CAPTURE_PRIVATE_KEY_FILE",
    "MAILBOX_HMAC_KEY_FILE",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET_FILE",
    "GOOGLE_OAUTH_REDIRECT_ORIGIN",
  ],
};

/**
 * A-248: the variables `kind` (and, for a worker, those roles; both when none are given) may
 * read, sorted. loadConfig reads nothing else, so the api never reads a capture secret.
 */
export function configKeysFor(kind: ProcessKind, roles?: readonly WorkerRole[]): readonly string[] {
  const keys = new Set(COMMON_KEYS);
  if (kind === "worker") {
    keys.add("WORKER_ROLES");
    for (const k of SEALING_KEYS) keys.add(k);
    for (const role of roles ?? (["general", "capture"] as const)) {
      for (const k of ROLE_KEYS[role]) keys.add(k);
    }
  } else {
    for (const k of KIND_KEYS[kind]) keys.add(k);
  }
  return [...keys].sort();
}

export function allConfigKeys(): string[] {
  return [...ALL_KEYS].sort();
}

export interface ConfigProblem {
  variable: string;
  rule: string;
}

/** What loadConfig hands the schema: the environment and each `*_FILE`'s content (one trailing
 * newline trimmed), or `null` when the file couldn't be read. */
export interface RawConfigInput {
  env: Readonly<Record<string, string | undefined>>;
  files: Readonly<Record<string, string | null>>;
}

/** F-10's release rule. */
export const RELEASE_PATTERN = /^(v\d+\.\d+\.\d+(-(hotfix|infra)\.\d+)?|dev)$/;

const PLACEHOLDER = "__FILL_ME__";
const SIGNIN_SUFFIX = ".apps.googleusercontent.com";
const ROLES: readonly DbLoginRole[] = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
];
/** F-10's KMS key version (without the `local:<n>` development form); A-260 reuses it. */
export const KMS_KEY_VERSION_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/\d+$/;
const KMS_VERSION = new RegExp(`^(?:${KMS_KEY_VERSION_PATTERN.source.slice(1, -1)}|local:\\d+)$`);

class Reader {
  readonly problems: ConfigProblem[] = [];
  private readonly failed = new Set<string>();

  constructor(
    readonly input: RawConfigInput,
    readonly appEnv: AppEnv,
  ) {}

  get prod(): boolean {
    return this.appEnv === "production" || this.appEnv === "rehearsal";
  }

  fail(variable: string, rule: string): void {
    if (this.failed.has(variable)) return;
    this.failed.add(variable);
    this.problems.push({ variable, rule });
  }

  /** A plain variable's value; empty counts as unset; the placeholder is a problem. */
  get(variable: string): string | undefined {
    const value = this.input.env[variable];
    if (value === undefined || value === "") return undefined;
    if (value === PLACEHOLDER) {
      this.fail(variable, "placeholder not filled");
      return undefined;
    }
    return value;
  }

  /** A `*_FILE` variable's content. `required`: report a missing variable. */
  file(variable: string, required: boolean): string | undefined {
    const path = this.input.env[variable];
    if (path === undefined || path === "") {
      if (required) this.fail(variable, "required");
      return undefined;
    }
    if (this.prod && !isAbsolute(path)) {
      this.fail(variable, "must be an absolute path");
      return undefined;
    }
    const content = this.input.files[path];
    if (content === undefined || content === null) {
      this.fail(variable, "file not readable");
      return undefined;
    }
    if (content === PLACEHOLDER) {
      this.fail(variable, "placeholder not filled");
      return undefined;
    }
    return content;
  }

  required(variable: string): string | undefined {
    const value = this.get(variable);
    if (value === undefined && !this.failed.has(variable)) this.fail(variable, "required");
    return value;
  }

  int(variable: string, min: number, max: number, fallback?: number): number | undefined {
    const value = this.get(variable);
    if (value === undefined) {
      if (fallback === undefined) this.fail(variable, "required");
      return fallback;
    }
    if (
      !/^\d+$/.test(value) ||
      Number.parseInt(value, 10) < min ||
      Number.parseInt(value, 10) > max
    ) {
      this.fail(variable, `must be an integer from ${String(min)} to ${String(max)}`);
      return undefined;
    }
    return Number.parseInt(value, 10);
  }

  oneOf<T extends string>(variable: string, options: readonly T[], fallback?: T): T | undefined {
    const value = this.get(variable);
    if (value === undefined) {
      if (fallback === undefined) this.fail(variable, "required");
      return fallback;
    }
    const match = options.find((o) => o === value);
    if (match === undefined) {
      this.fail(variable, `must be one of: ${options.join(", ")}`);
    }
    return match;
  }

  httpsUrl(variable: string, value: string | undefined = this.get(variable)): URL | undefined {
    if (value === undefined) return undefined;
    const url = parseUrl(value);
    if (url?.protocol !== "https:") {
      this.fail(variable, "must be an https URL");
      return undefined;
    }
    return url;
  }

  /** An origin: `https://host[:port]` or exactly `http://localhost:<port>`, nothing else. */
  origin(variable: string, value: string | undefined): URL | undefined {
    if (value === undefined) return undefined;
    const url = parseUrl(value);
    const ok =
      url !== null &&
      url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && url.hostname === "localhost" && url.port !== ""));
    if (!ok) {
      this.fail(variable, "must be an https origin or http://localhost:<port>, without a path");
      return undefined;
    }
    return url;
  }

  base64(
    variable: string,
    content: string | undefined,
    bytes: number,
    exact: boolean,
  ): Buffer | undefined {
    if (content === undefined) return undefined;
    const buffer = Buffer.from(content.trim(), "base64");
    const valid =
      /^[A-Za-z0-9+/]+={0,2}$/.test(content.trim()) &&
      (exact ? buffer.length === bytes : buffer.length >= bytes);
    if (!valid) {
      this.fail(
        variable,
        exact
          ? `must be base64 of ${String(bytes)} bytes`
          : `must be base64 of at least ${String(bytes)} bytes`,
      );
      return undefined;
    }
    return buffer;
  }

  keyRing(variable: string): KeyRing | undefined {
    const content = this.file(variable, true);
    if (content === undefined) return undefined;
    try {
      const parsed = z
        .object({ current: z.string(), keys: z.record(z.string(), z.string()) })
        .parse(JSON.parse(content));
      const keys = new Map<string, Buffer>();
      for (const [id, key] of Object.entries(parsed.keys)) {
        const buffer = Buffer.from(key, "base64");
        if (!/^[a-z0-9]{1,16}$/.test(id) || buffer.length !== 32) throw new Error("bad key");
        keys.set(id, buffer);
      }
      if (!keys.has(parsed.current)) throw new Error("current not in keys");
      return Secret.of({ current: parsed.current, keys });
    } catch {
      this.fail(variable, "must be a key ring: { current, keys } with 32-byte keys");
      return undefined;
    }
  }

  rsaPublicKey(variable: string): string | undefined {
    const content = this.file(variable, true);
    if (content === undefined) return undefined;
    const bits = rsaModulusBits(content);
    if (bits === undefined || bits < 3072) {
      this.fail(variable, "must be a PEM RSA public key of at least 3072 bits");
      return undefined;
    }
    return content;
  }
}

function decodesCleanly(text: string): boolean {
  try {
    decodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function rsaModulusBits(pem: string): number | undefined {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "rsa" ? key.asymmetricKeyDetails?.modulusLength : undefined;
  } catch {
    return undefined;
  }
}

/** A-131: public key, host, optional port, numeric project id; nothing else. */
export const SENTRY_DSN_PATTERN =
  /^https:\/\/[A-Za-z0-9]{1,64}@[A-Za-z0-9.-]{1,253}(:\d{1,5})?\/\d{1,20}$/;

/** A-141: a local http DSN, accepted only in development and test. */
export const LOCAL_SENTRY_DSN_PATTERN =
  /^http:\/\/[A-Za-z0-9]{1,64}@(localhost|127\.0\.0\.1):\d{1,5}\/\d{1,20}$/;

/** A-131, A-141: whether `dsn` is an acceptable `SENTRY_DSN` in `appEnv`. */
export function isValidSentryDsn(dsn: string, appEnv: AppEnv): boolean {
  if (SENTRY_DSN_PATTERN.test(dsn)) return true;
  return (appEnv === "development" || appEnv === "test") && LOCAL_SENTRY_DSN_PATTERN.test(dsn);
}

const OTLP_HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

/** A-138: https, or http://localhost:<port> in development and test; no query or fragment. */
function readOtlpEndpoint(r: Reader): URL | undefined {
  const variable = "OTEL_EXPORTER_OTLP_ENDPOINT";
  const raw = r.get(variable);
  if (raw === undefined) return undefined;
  const url = parseUrl(raw);
  if (url === null) {
    r.fail(variable, "must be a URL");
    return undefined;
  }
  const localHttp =
    !r.prod && url.protocol === "http:" && url.hostname === "localhost" && url.port !== "";
  if (url.protocol !== "https:" && !localHttp) {
    r.fail(variable, "must be an https URL");
    return undefined;
  }
  if (url.search !== "" || url.hash !== "" || raw.includes("?") || raw.includes("#")) {
    r.fail(variable, "must not have a query or fragment");
    return undefined;
  }
  if (url.username !== "" || url.password !== "") {
    // A-142: credentials count as a wrong URL.
    r.fail(variable, "must be an https URL");
    return undefined;
  }
  return url;
}

/** A-138: a JSON object of header names to string values. */
function readOtlpHeaders(r: Reader): Secret<Record<string, string>> | undefined {
  const variable = "OTLP_HEADERS_FILE";
  const content = r.file(variable, false);
  if (content === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    r.fail(variable, "invalid");
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    r.fail(variable, "invalid");
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!OTLP_HEADER_NAME.test(name) || typeof value !== "string") {
      r.fail(variable, "invalid");
      return undefined;
    }
    headers[name] = value;
  }
  return Secret.of(headers);
}

function trustedProxy(r: Reader): string[] {
  const value = r.get("TRUSTED_PROXY");
  if (value === undefined) {
    if (r.prod) r.fail("TRUSTED_PROXY", "required");
    return [];
  }
  const entries = value.split(",").map((s) => s.trim());
  const valid = entries.every((entry) => {
    const [address = "", prefix, ...rest] = entry.split("/");
    if (rest.length > 0 || isIP(address) === 0) return false;
    const max = isIP(address) === 4 ? 32 : 128;
    return prefix === undefined || (/^\d+$/.test(prefix) && Number.parseInt(prefix, 10) <= max);
  });
  if (!valid) {
    r.fail("TRUSTED_PROXY", "must be a comma list of IPs or CIDRs");
    return [];
  }
  return entries;
}

function readDb(
  r: Reader,
  kind: ProcessKind,
  roles: ReadonlySet<WorkerRole> | undefined,
): Config["db"] | undefined {
  const host = r.required("DB_HOST");
  const name = r.required("DB_NAME");
  const user = r.required("DB_USER");
  // A-299: a capture-only worker's pg-boss connects as DB_USER, which RLS allows only as
  // budmon_capture.
  if (
    user !== undefined &&
    roles?.size === 1 &&
    roles.has("capture") &&
    user !== "budmon_capture"
  ) {
    r.fail("DB_USER", "must be budmon_capture for a capture-only worker");
  }
  const port = r.int("DB_PORT", 1, 65535, 5432);
  const password = r.file("DB_PASSWORD_FILE", true);
  const sslmode = r.oneOf("DB_SSLMODE", ["disable", "verify-full"] as const, "disable");
  const defaultPool = kind === "api" ? 10 : kind === "worker" ? 5 : 2;
  const poolMax = r.int("DB_POOL_MAX", 1, 50, defaultPool);
  let sslRootCert: Buffer | undefined;
  if (sslmode === "verify-full") {
    const cert = r.file("DB_SSL_ROOT_CERT_FILE", true);
    if (cert !== undefined) sslRootCert = Buffer.from(cert, "utf8");
  } else if (sslmode === "disable" && r.prod && roles?.has("capture") === true) {
    r.fail("DB_SSLMODE", "not allowed in production");
  }
  if (
    host === undefined ||
    name === undefined ||
    user === undefined ||
    port === undefined ||
    password === undefined ||
    sslmode === undefined ||
    poolMax === undefined
  ) {
    return undefined;
  }
  return {
    host,
    port,
    name,
    user,
    password: Secret.of(password),
    sslmode,
    ...(sslRootCert === undefined ? {} : { sslRootCert }),
    poolMax,
  };
}

function readMigrate(r: Reader): Config["migrate"] | undefined {
  const content = r.file("ROLE_SECRETS_FILE", true);
  const previous = r.file("DB_PASSWORD_PREVIOUS_FILE", false);
  if (content === undefined) return undefined;
  try {
    const parsed = z
      .record(
        z.string(),
        z.union([
          z.object({ verifier: z.string().min(1) }),
          z.object({ password: z.string().min(1) }),
        ]),
      )
      .parse(JSON.parse(content));
    const roleSecrets = {} as Record<
      DbLoginRole,
      { verifier: string } | { password: Secret<string> }
    >;
    let passwordForm = false;
    for (const role of ROLES) {
      const entry = parsed[role];
      if (entry === undefined) throw new Error("missing role");
      if ("verifier" in entry) {
        roleSecrets[role] = { verifier: entry.verifier };
      } else {
        passwordForm = true;
        roleSecrets[role] = { password: Secret.of(entry.password) };
      }
    }
    if (passwordForm && r.prod) {
      r.fail("ROLE_SECRETS_FILE", "not allowed in production");
      return undefined;
    }
    return {
      roleSecrets,
      ...(previous === undefined ? {} : { previousPassword: Secret.of(previous) }),
    };
  } catch {
    r.fail("ROLE_SECRETS_FILE", "must be JSON with a verifier or password for every login role");
    return undefined;
  }
}

function readWorkerRoles(r: Reader): ReadonlySet<WorkerRole> | undefined {
  const value = r.required("WORKER_ROLES");
  if (value === undefined) return undefined;
  const parts = value.split(",").map((s) => s.trim());
  const roles = new Set<WorkerRole>();
  for (const part of parts) {
    if (part !== "capture" && part !== "general") {
      r.fail("WORKER_ROLES", "must be a comma list of: capture, general");
      return undefined;
    }
    roles.add(part);
  }
  if (r.prod && roles.size !== 1) {
    r.fail("WORKER_ROLES", "not allowed in production");
    return undefined;
  }
  return roles;
}

function readCapturePublic(r: Reader): { publicKeyPem: string; keyVersion: string } | undefined {
  const publicKeyPem = r.rsaPublicKey("CAPTURE_PUBLIC_KEY_FILE");
  const keyVersion = r.required("CAPTURE_KEY_VERSION");
  if (keyVersion !== undefined) {
    if (!KMS_VERSION.test(keyVersion)) {
      r.fail("CAPTURE_KEY_VERSION", "must be a KMS key version or local:<n>");
      return undefined;
    }
    if (r.prod && keyVersion.startsWith("local:") && r.appEnv !== "rehearsal") {
      r.fail("CAPTURE_KEY_VERSION", "not allowed in production");
      return undefined;
    }
  }
  return publicKeyPem === undefined || keyVersion === undefined
    ? undefined
    : { publicKeyPem, keyVersion };
}

/**
 * A-356: https, or in development and test `http://localhost:<port>` or `http://127.0.0.1:<port>`
 * (a local S3-compatible server).
 */
function readS3Endpoint(r: Reader): URL | undefined {
  const raw = r.required("S3_ENDPOINT");
  if (raw === undefined) return undefined;
  const url = parseUrl(raw);
  if (
    url !== null &&
    !r.prod &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port !== ""
  ) {
    return url;
  }
  return r.httpsUrl("S3_ENDPOINT", raw);
}

function readObjectStore(r: Reader): Config["objectStore"] | undefined {
  const kind = r.oneOf("OBJECT_STORE_KIND", ["fs", "s3"] as const);
  if (kind === undefined) return undefined;
  if (kind === "fs") {
    if (r.prod) {
      r.fail("OBJECT_STORE_KIND", "not allowed in production");
      return undefined;
    }
    const root = r.required("OBJECT_STORE_FS_ROOT");
    return root === undefined ? undefined : { kind: "fs", root };
  }
  const endpoint = readS3Endpoint(r);
  const region = r.required("S3_REGION");
  const exports = r.required("S3_BUCKET_EXPORTS");
  const erasureLog = r.required("S3_BUCKET_ERASURE_LOG");
  const accessKeyId = r.file("S3_ACCESS_KEY_ID_FILE", true);
  const secretAccessKey = r.file("S3_SECRET_ACCESS_KEY_FILE", true);
  if (
    endpoint === undefined ||
    region === undefined ||
    exports === undefined ||
    erasureLog === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    return undefined;
  }
  return {
    kind: "s3",
    endpoint,
    region,
    buckets: { exports, erasureLog },
    accessKeyId: Secret.of(accessKeyId),
    secretAccessKey: Secret.of(secretAccessKey),
  };
}

function publicOrigin(r: Reader): URL | undefined {
  const value = r.required("PUBLIC_ORIGIN");
  if (value === undefined) return undefined;
  const url = parseUrl(value);
  const local = url?.protocol === "http:" && url.hostname === "localhost";
  if (url === null || !(url.protocol === "https:" || (local && !r.prod))) {
    r.fail("PUBLIC_ORIGIN", "must be an https URL");
    return undefined;
  }
  return url;
}

function readEmail(r: Reader, publicOriginUrl: URL | undefined): Config["email"] | undefined {
  const raw = r.required("SMTP_URL");
  const from = r.required("EMAIL_FROM");
  const passwordContent = r.file("SMTP_PASSWORD_FILE", false);
  if (from !== undefined && !/^(?:[^<>@]+<)?[^<>@\s]+@[^<>@\s]+>?$/.test(from)) {
    r.fail("EMAIL_FROM", "must be an email address or mailbox");
  }
  let smtpUrl: URL | undefined;
  let smtpTransport: NonNullable<Config["email"]>["smtpTransport"] | undefined;
  if (raw !== undefined) {
    const url = parseUrl(raw);
    const explicitPort = /^smtps?:\/\/[^/?#]*:(\d+)(?:[/?#]|$)/i.exec(raw)?.[1];
    if (
      explicitPort !== undefined &&
      (Number.parseInt(explicitPort, 10) < 1 || Number.parseInt(explicitPort, 10) > 65535)
    ) {
      r.fail("SMTP_URL", "port must be 1..65535");
    } else if (/^smtps?:\/\/(?:[^@/?#]*@)?(?::\d*)?(?:[/?#]|$)/i.test(raw)) {
      // WHATWG URL parsing rejects an empty host before it can be checked below.
      r.fail("SMTP_URL", "must have a host");
    } else if (url === null || (url.protocol !== "smtp:" && url.protocol !== "smtps:")) {
      r.fail("SMTP_URL", "must be an smtp:// or smtps:// URL");
    } else if (url.password !== "") {
      r.fail("SMTP_URL", "must not contain a password");
    } else if (url.hostname === "") {
      r.fail("SMTP_URL", "must have a host");
    } else if (
      (url.pathname !== "" && url.pathname !== "/") ||
      raw.includes("?") ||
      raw.includes("#")
    ) {
      r.fail("SMTP_URL", "must not have a path, query or fragment");
    } else if (!decodesCleanly(url.username)) {
      r.fail("SMTP_URL", "must be a valid URL");
    } else {
      const host = url.hostname;
      const implicit = url.protocol === "smtps:";
      const local = (host === "localhost" || host === "127.0.0.1") && !r.prod;
      const plain = !implicit && (host === "mailpit" || local);
      const port = url.port === "" ? (implicit ? 465 : 587) : Number.parseInt(url.port, 10);
      const user = decodeURIComponent(url.username);
      smtpUrl = url;
      smtpTransport = {
        security: implicit ? "implicit_tls" : plain ? "none" : "starttls",
        host,
        port,
        ...(user === "" ? {} : { user }),
      };
      if (!implicit && !plain && (host === "localhost" || host === "127.0.0.1")) {
        r.fail("SMTP_URL", "plain SMTP is only allowed in development and test");
        return undefined;
      }
    }
  }
  if (
    smtpUrl === undefined ||
    smtpTransport === undefined ||
    from === undefined ||
    publicOriginUrl === undefined
  ) {
    return undefined;
  }
  return {
    smtpUrl,
    smtpTransport,
    ...(passwordContent === undefined || passwordContent === ""
      ? {}
      : { smtpPassword: Secret.of(passwordContent) }),
    from,
    publicOrigin: publicOriginUrl,
  };
}

function readFx(r: Reader): Config["fx"] | undefined {
  // A-276: absent means fixed in development and test, and is required in prod.
  if (r.get("FX_PROVIDER") === undefined) {
    if (r.prod) {
      r.fail("FX_PROVIDER", "required");
      return undefined;
    }
    return { provider: "fixed" };
  }
  const provider = r.oneOf("FX_PROVIDER", ["live", "fixed"] as const);
  if (provider === undefined) return undefined;
  if (provider === "fixed") {
    if (r.prod) {
      r.fail("FX_PROVIDER", "not allowed in production");
      return undefined;
    }
    return { provider: "fixed" };
  }
  const appId = r.file("FX_PRIMARY_APP_ID_FILE", true);
  const primary = r.get("FX_PRIMARY_BASE_URL") ?? "https://openexchangerates.org/api";
  const primaryUrl = r.httpsUrl("FX_PRIMARY_BASE_URL", primary);
  const fallback =
    r.get("FX_FALLBACK_BASE_URL") ??
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1";
  const mirror = r.get("FX_FALLBACK_MIRROR_URL") ?? "https://{date}.currency-api.pages.dev/v1";
  r.httpsUrl("FX_FALLBACK_BASE_URL", fallback);
  r.httpsUrl("FX_FALLBACK_MIRROR_URL", mirror);
  if (appId === undefined || primaryUrl === undefined) return undefined;
  return {
    provider: "live",
    primaryAppId: Secret.of(appId),
    primaryBaseUrl: primaryUrl,
    fallbackBaseUrl: fallback,
    fallbackMirrorUrl: mirror,
  };
}

function readCaptureRole(r: Reader): Config["capture"] | undefined {
  const pub = readCapturePublic(r);
  const provider = r.oneOf("KMS_PROVIDER", ["gcp", "local"] as const);
  let kms: NonNullable<Config["capture"]>["kms"] | undefined;
  if (provider === "gcp") {
    const content = r.file("GCP_CREDENTIALS_FILE", true);
    if (content !== undefined) {
      try {
        kms = {
          provider: "gcp",
          credentials: Secret.of(z.object({}).loose().parse(JSON.parse(content))),
        };
      } catch {
        r.fail("GCP_CREDENTIALS_FILE", "must be service-account JSON");
      }
    }
  } else if (provider === "local") {
    if (r.appEnv === "production") {
      r.fail("KMS_PROVIDER", "not allowed in production");
    } else {
      const pem = r.file("CAPTURE_PRIVATE_KEY_FILE", true);
      if (pem !== undefined) kms = { provider: "local", privateKeyPem: Secret.of(pem) };
    }
  }
  const mailboxContent = r.file("MAILBOX_HMAC_KEY_FILE", true);
  const mailbox = r.base64("MAILBOX_HMAC_KEY_FILE", mailboxContent, 32, false);

  const clientId = r.get("GOOGLE_OAUTH_CLIENT_ID");
  let oauth: NonNullable<Config["capture"]>["oauth"] | undefined;
  if (clientId === undefined) {
    if (r.prod) r.fail("GOOGLE_OAUTH_CLIENT_ID", "required");
  } else {
    const secret = r.file("GOOGLE_OAUTH_CLIENT_SECRET_FILE", true);
    const origin = r.origin(
      "GOOGLE_OAUTH_REDIRECT_ORIGIN",
      r.required("GOOGLE_OAUTH_REDIRECT_ORIGIN"),
    );
    if (secret !== undefined && origin !== undefined) {
      oauth = { clientId, clientSecret: Secret.of(secret), redirectOrigin: origin };
    }
  }
  if (pub === undefined || kms === undefined || mailbox === undefined) return undefined;
  if (clientId !== undefined && oauth === undefined) return undefined;
  return {
    publicKeyPem: pub.publicKeyPem,
    keyVersion: pub.keyVersion,
    kms,
    ...(oauth === undefined ? {} : { oauth }),
    mailboxHmacKey: Secret.of(mailbox),
  };
}

function readApi(r: Reader): {
  api?: Config["api"];
  sealing?: Config["sealing"];
  objectStore?: Config["objectStore"];
} {
  const port = r.int("PORT", 1, 65535, 3000);
  const host = r.get("HOST") ?? "0.0.0.0";
  const origin = publicOrigin(r);
  const redirectRaw = r.get("GOOGLE_OAUTH_REDIRECT_ORIGIN");
  const redirectOrigin =
    redirectRaw === undefined
      ? origin === undefined
        ? undefined
        : new URL(origin.origin)
      : r.origin("GOOGLE_OAUTH_REDIRECT_ORIGIN", redirectRaw);
  const proxy = trustedProxy(r);
  const min = r.int("CLIENT_MIN_ANDROID", 0, Number.MAX_SAFE_INTEGER, 0);
  const latest = r.int("CLIENT_LATEST_ANDROID", 0, Number.MAX_SAFE_INTEGER, 0);
  const minWeb = r.int("CLIENT_MIN_WEB", 0, Number.MAX_SAFE_INTEGER, 0);
  if (min !== undefined && latest !== undefined && latest < min) {
    r.fail("CLIENT_LATEST_ANDROID", "must be at least CLIENT_MIN_ANDROID");
  }
  const downloadRaw = r.get("ANDROID_DOWNLOAD_URL");
  const androidDownloadUrl = r.httpsUrl("ANDROID_DOWNLOAD_URL", downloadRaw);
  const cursor = r.base64("CURSOR_KEY_FILE", r.file("CURSOR_KEY_FILE", true), 32, true);
  const rate = r.base64(
    "RATE_LIMIT_HMAC_KEY_FILE",
    r.file("RATE_LIMIT_HMAC_KEY_FILE", true),
    32,
    false,
  );
  const secrets = r.keyRing("API_SECRETS_KEYS_FILE");
  const recovery = r.keyRing("RECOVERY_CODE_HMAC_KEYS_FILE");
  const sealing = readCapturePublic(r);
  const objectStore = readObjectStore(r);
  let devKey: Buffer | undefined;
  // A-303: the API presigns filesystem URLs in development and test.
  if ((r.appEnv === "development" || r.appEnv === "test") && objectStore?.kind === "fs") {
    devKey = r.base64(
      "DEV_OBJECTS_SIGNING_KEY_FILE",
      r.file("DEV_OBJECTS_SIGNING_KEY_FILE", true),
      32,
      false,
    );
  }

  // Google sign-in (A-3).
  const signInId = r.get("GOOGLE_SIGNIN_CLIENT_ID");
  let googleSignIn: NonNullable<Config["api"]>["googleSignIn"];
  const androidRaw = r.get("GOOGLE_SIGNIN_ANDROID_CLIENT_IDS");
  const androidClientIds =
    androidRaw === undefined ? [] : androidRaw.split(",").map((s) => s.trim());
  if (androidClientIds.some((id) => !id.endsWith(SIGNIN_SUFFIX))) {
    r.fail("GOOGLE_SIGNIN_ANDROID_CLIENT_IDS", `each id must end in ${SIGNIN_SUFFIX}`);
  }
  if (signInId === undefined) {
    if (r.prod) r.fail("GOOGLE_SIGNIN_CLIENT_ID", "required");
  } else if (!signInId.endsWith(SIGNIN_SUFFIX)) {
    r.fail("GOOGLE_SIGNIN_CLIENT_ID", `must end in ${SIGNIN_SUFFIX}`);
  } else {
    const secret = r.file("GOOGLE_SIGNIN_CLIENT_SECRET_FILE", true);
    const callback = r.origin(
      "GOOGLE_SIGNIN_CALLBACK_ORIGIN",
      r.required("GOOGLE_SIGNIN_CALLBACK_ORIGIN"),
    );
    const originsRaw = r.required("GOOGLE_SIGNIN_APP_ORIGINS");
    const appOrigins = originsRaw
      ?.split(",")
      .map((s) => r.origin("GOOGLE_SIGNIN_APP_ORIGINS", s.trim()));
    if (
      secret !== undefined &&
      callback !== undefined &&
      appOrigins !== undefined &&
      appOrigins.every((o) => o !== undefined)
    ) {
      googleSignIn = {
        clientId: signInId,
        clientSecret: Secret.of(secret),
        androidClientIds,
        callbackOrigin: callback,
        appOrigins,
      };
    }
  }

  if (
    port === undefined ||
    origin === undefined ||
    redirectOrigin === undefined ||
    min === undefined ||
    latest === undefined ||
    minWeb === undefined ||
    cursor === undefined ||
    rate === undefined ||
    secrets === undefined ||
    recovery === undefined
  ) {
    return {};
  }
  return {
    api: {
      port,
      host,
      publicOrigin: origin,
      googleOAuthRedirectOrigin: redirectOrigin,
      trustedProxy: proxy,
      clientVersions: {
        minAndroid: min,
        latestAndroid: latest,
        minWeb,
        ...(androidDownloadUrl === undefined ? {} : { androidDownloadUrl }),
      },
      cursorKey: Secret.of(cursor),
      rateLimitKey: Secret.of(rate),
      apiSecretsKeys: secrets,
      ...(devKey === undefined ? {} : { devObjectsKey: Secret.of(devKey) }),
      ...(googleSignIn === undefined ? {} : { googleSignIn }),
      recoveryCodeKeys: recovery,
    },
    ...(sealing === undefined ? {} : { sealing }),
    ...(objectStore === undefined ? {} : { objectStore }),
  };
}

/** Validates the raw input for `kind`. Returns the Config, or every problem found. */
export function parseConfig(
  kind: ProcessKind,
  input: RawConfigInput,
): { ok: true; config: Config } | { ok: false; problems: ConfigProblem[] } {
  const probe = new Reader(input, "development");
  const appEnv = probe.oneOf("APP_ENV", [
    "development",
    "test",
    "rehearsal",
    "production",
  ] as const);
  const r = new Reader(input, appEnv ?? "development");
  for (const problem of probe.problems) r.fail(problem.variable, problem.rule);

  const logLevel = r.oneOf("LOG_LEVEL", ["debug", "info", "warn", "error"] as const, "info");
  let release = r.get("BUDMON_RELEASE");
  if (release === undefined) {
    if (r.prod) r.fail("BUDMON_RELEASE", "required");
    release = "dev";
  } else if (!RELEASE_PATTERN.test(release)) {
    r.fail("BUDMON_RELEASE", "must be a release version or dev");
  } else if (r.prod && release === "dev") {
    r.fail("BUDMON_RELEASE", "not allowed in production");
  }
  const otlp = readOtlpEndpoint(r);
  const otlpHeaders = readOtlpHeaders(r);
  const sentryDsn = r.get("SENTRY_DSN");
  // A-131: the value is never echoed.
  if (sentryDsn !== undefined && !isValidSentryDsn(sentryDsn, r.appEnv))
    r.fail("SENTRY_DSN", "invalid DSN");

  const roles = kind === "worker" ? readWorkerRoles(r) : undefined;
  const db = readDb(r, kind, roles);
  const partial: Partial<Config> = {};

  if (kind === "migrate") {
    const migrate = readMigrate(r);
    if (migrate !== undefined) partial.migrate = migrate;
  } else if (kind === "api") {
    Object.assign(partial, readApi(r));
  } else if (roles !== undefined) {
    const worker: NonNullable<Config["worker"]> = { roles };
    const general = roles.has("general");
    const capture = roles.has("capture");
    let queue: NonNullable<Config["worker"]>["queue"];
    if (general) {
      const user = r.required("QUEUE_DB_USER");
      const password = r.file("QUEUE_DB_PASSWORD_FILE", true);
      const poolMax = r.int("QUEUE_POOL_MAX", 1, 10, 3);
      if (user !== undefined && password !== undefined && poolMax !== undefined) {
        queue = { user, password: Secret.of(password), poolMax };
      }
    }
    const sealing = readCapturePublic(r);
    if (sealing !== undefined) partial.sealing = sealing;
    if (capture) {
      const c = readCaptureRole(r);
      if (c !== undefined) partial.capture = c;
    }
    if (general) {
      const origin = publicOrigin(r);
      const email = readEmail(r, origin);
      if (email !== undefined) partial.email = email;
      const fx = readFx(r);
      if (fx !== undefined) partial.fx = fx;
      const store = readObjectStore(r);
      if (store !== undefined) partial.objectStore = store;
    }
    partial.worker = queue === undefined ? worker : { ...worker, queue };
  }

  if (r.problems.length > 0 || db === undefined || appEnv === undefined || logLevel === undefined) {
    return { ok: false, problems: r.problems };
  }
  const config: Config = {
    kind,
    appEnv,
    logLevel,
    release,
    db,
    ...partial,
    ...(otlp === undefined ? {} : { otlpEndpoint: otlp }),
    ...(otlpHeaders === undefined ? {} : { otlpHeaders }),
    ...(sentryDsn === undefined ? {} : { sentryDsn }),
  };
  return { ok: true, config };
}

/** The schema as a zod type over `RawConfigInput` (F-10's `configSchemaFor`). */
export function configSchemaFor(kind: ProcessKind): z.ZodType<Config> {
  return z.custom<RawConfigInput>().transform((input, ctx): Config => {
    const result = parseConfig(kind, input);
    if (result.ok) return result.config;
    for (const problem of result.problems) {
      ctx.addIssue({ code: "custom", path: [problem.variable], message: problem.rule });
    }
    return z.NEVER;
  });
}
