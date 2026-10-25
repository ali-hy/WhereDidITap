// F-191: the laptop's secret files under BUDMON_HOME/secrets, generated once. Files are written
// by the calling WSL user (dirs 0700, files 0600); F-178 then hands each service directory to its
// container's UID. Nothing is printed but the file list.
import path from "node:path";
import { scramVerifier } from "./scram.js";

export const PLACEHOLDER = "__FILL_ME__";

export class SecretsExistError extends Error {
  constructor() {
    super("secrets already exist");
    this.name = "SecretsExistError";
  }
}

export interface LocalSecretsDeps {
  randomBytes: (n: number) => Buffer;
  mkdir: (path: string, mode: number) => Promise<void>;
  writeFile: (path: string, data: string, mode: number) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
}

const ROLES = [
  "budmon_app",
  "budmon_capture",
  "budmon_queue",
  "budmon_monitor",
  "budmon_migrator",
] as const;

export async function initLocalSecrets(
  input: { budmonHome: string },
  deps: LocalSecretsDeps,
): Promise<{ files: string[] }> {
  const secrets = path.join(input.budmonHome, "secrets");
  if (await deps.exists(secrets)) throw new SecretsExistError();

  /** Passwords: 32 random bytes, base64url. Keys: 32 bytes, base64. */
  const password = () => deps.randomBytes(32).toString("base64url");
  const key = () => deps.randomBytes(32).toString("base64");
  const keyRing = () => JSON.stringify({ current: "k1", keys: { k1: key() } });

  const passwords = Object.fromEntries(ROLES.map((r) => [r, password()])) as Record<
    (typeof ROLES)[number],
    string
  >;
  const roleSecrets = JSON.stringify(
    Object.fromEntries(ROLES.map((r) => [r, { verifier: scramVerifier(passwords[r]) }])),
  );

  const layout: Record<string, Record<string, string>> = {
    "main/api": {
      DB_PASSWORD: passwords.budmon_app,
      CURSOR_KEY: key(),
      RATE_LIMIT_HMAC_KEY: key(),
      API_SECRETS_KEYS: keyRing(),
      RECOVERY_CODE_HMAC_KEYS: keyRing(),
      S3_ACCESS_KEY_ID: PLACEHOLDER,
      S3_SECRET_ACCESS_KEY: PLACEHOLDER,
      CAPTURE_PUBLIC_KEY: PLACEHOLDER,
      GOOGLE_SIGNIN_CLIENT_SECRET: PLACEHOLDER,
    },
    "main/worker-general": {
      DB_PASSWORD: passwords.budmon_app,
      QUEUE_DB_PASSWORD: passwords.budmon_queue,
      SMTP_PASSWORD: "",
      S3_ACCESS_KEY_ID: PLACEHOLDER,
      S3_SECRET_ACCESS_KEY: PLACEHOLDER,
      FX_PRIMARY_APP_ID: PLACEHOLDER,
      CAPTURE_PUBLIC_KEY: PLACEHOLDER,
    },
    "main/migrate": {
      DB_PASSWORD: passwords.budmon_migrator,
      ROLE_SECRETS: roleSecrets,
    },
    "main/postgres": {
      ADMIN_PASSWORD: password(),
      MIGRATOR_VERIFIER: scramVerifier(passwords.budmon_migrator),
    },
    "capture/worker-capture": {
      DB_PASSWORD: passwords.budmon_capture,
      MAILBOX_HMAC_KEY: key(),
      GCP_CREDENTIALS: PLACEHOLDER,
      GOOGLE_OAUTH_CLIENT_SECRET: PLACEHOLDER,
      CAPTURE_PUBLIC_KEY: PLACEHOLDER,
    },
  };

  await deps.mkdir(secrets, 0o700);
  await deps.mkdir(path.join(secrets, "main"), 0o700);
  await deps.mkdir(path.join(secrets, "capture"), 0o700);
  const files: string[] = [];
  for (const [dir, entries] of Object.entries(layout)) {
    await deps.mkdir(path.join(secrets, dir), 0o700);
    for (const [name, value] of Object.entries(entries)) {
      const rel = `${dir}/${name}`;
      await deps.writeFile(path.join(secrets, rel), value, 0o600);
      files.push(rel);
    }
  }
  // The marker last, so an interrupted run is visible as "secrets exist, not initialised".
  await deps.writeFile(path.join(secrets, ".initialised"), "", 0o600);
  // A-405: relative to secrets/, in write order, ending with the marker.
  files.push(".initialised");
  return { files };
}
