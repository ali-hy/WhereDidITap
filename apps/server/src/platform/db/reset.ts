// F-20: the guarded development database reset, and the guarded seeding.
import pg from "pg";
import { parse as parseConnectionString } from "pg-connection-string";
import { createDatabase } from "./client.js";
import { bootstrapCluster } from "./clusterBootstrap.js";
import { createLogger } from "../observability/logger.js";
import { Secret } from "../observability/redaction.js";
import { buildJobRegistry } from "../queue/appRegistry.js";
import { serverRoot } from "../config/serverRoot.js";
import iso4217 from "../fx/iso4217.json" with { type: "json" };
import path from "node:path";
import type { AppEnv, DbLoginRole } from "../config/schema.js";
import type { runSchemaStep } from "./schemaStep.js";

const APP_ENVS: readonly AppEnv[] = ["development", "test", "rehearsal", "production"];

export function isAppEnv(value: unknown): value is AppEnv {
  return APP_ENVS.some((env) => env === value);
}

export type ResetRefusedReason =
  "app_env" | "non_local_host" | "host_parameter" | "host_list" | "socket_path" | "unparseable_url";

const PHRASES: Record<Exclude<ResetRefusedReason, "app_env">, string> = {
  non_local_host: "the host isn't local",
  host_parameter: "the URL sets a host parameter",
  host_list: "the URL lists several hosts",
  socket_path: "the URL is a socket path",
  unparseable_url: "the URL can't be parsed",
};

/** The message names the reason, never the URL, host, user or password (A-84). */
export class ResetRefusedError extends Error {
  readonly reason: ResetRefusedReason;

  constructor(command: "db:reset" | "db:seed", reason: ResetRefusedReason, appEnv?: unknown) {
    // Only a known AppEnv is ever written; anything else gets a fixed phrase (A-93).
    const phrase =
      reason !== "app_env"
        ? PHRASES[reason]
        : isAppEnv(appEnv)
          ? `APP_ENV is ${appEnv}`
          : "APP_ENV is not a known environment";
    super(`${command} only runs against a local development or test database: ${phrase}`);
    this.name = "ResetRefusedError";
    this.reason = reason;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** Why pg wouldn't be connecting to an acceptable server with this URL, or `null`. `pg` lets
 * `?host=` and `?hostaddr=` override the URL's host, so those parameters, host lists and socket
 * paths are always refused; the host is the one pg-connection-string reports.
 * `allowNonLocalHost` skips only the allowlist of local hosts. */
function urlRefusal(
  superuserUrl: string,
  allowNonLocalHost: boolean,
): Exclude<ResetRefusedReason, "app_env"> | null {
  let host: string | null | undefined;
  try {
    const query = new URL(superuserUrl).searchParams;
    if (query.has("host") || query.has("hostaddr")) return "host_parameter";
    host = parseConnectionString(superuserUrl).host;
  } catch {
    return "unparseable_url";
  }
  if (typeof host !== "string" || host === "") return "unparseable_url";
  if (host.includes(",")) return "host_list";
  if (host.startsWith("/")) return "socket_path";
  return allowNonLocalHost || LOCAL_HOSTS.has(host) ? null : "non_local_host";
}

function assertLocalDevelopment(
  command: "db:reset" | "db:seed",
  appEnv: AppEnv,
  superuserUrl: string,
  allowNonLocalHost: boolean,
): void {
  // The input type can be bypassed, so the value is checked here too (A-93).
  if (!isAppEnv(appEnv) || (appEnv !== "development" && appEnv !== "test")) {
    throw new ResetRefusedError(command, "app_env", appEnv);
  }
  const refusal = urlRefusal(superuserUrl, allowNonLocalHost);
  if (refusal !== null) throw new ResetRefusedError(command, refusal);
}

export async function resetDevelopmentDatabase(
  input: {
    appEnv: AppEnv;
    superuserUrl: string;
    databaseName: string;
    migratorPassword: string;
    roleSecrets: Record<DbLoginRole, { verifier: string } | { password: string }>;
    seed: boolean;
    /** Skips only the allowlist of local hosts (for test containers). Default false. */
    allowNonLocalHost?: boolean;
  },
  deps: { runSchemaStep: typeof runSchemaStep; seed: () => Promise<void> },
): Promise<void> {
  assertLocalDevelopment(
    "db:reset",
    input.appEnv,
    input.superuserUrl,
    input.allowNonLocalHost === true,
  );

  const superuser = new pg.Client({ connectionString: input.superuserUrl });
  await superuser.connect();
  try {
    await superuser.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [input.databaseName],
    );
    await superuser.query(
      `DROP DATABASE IF EXISTS ${superuser.escapeIdentifier(input.databaseName)} WITH (FORCE)`,
    );
    await bootstrapCluster(superuser, {
      databaseName: input.databaseName,
      migrator: { password: input.migratorPassword },
    });
  } finally {
    await superuser.end();
  }

  const url = new URL(input.superuserUrl);
  const database = createDatabase(
    {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port === "" ? 5432 : Number.parseInt(url.port, 10),
      name: input.databaseName,
      user: "budmon_migrator",
      password: Secret.of(input.migratorPassword),
      sslmode: "disable",
      poolMax: 2,
    },
    { applicationName: "budmon-db-reset" },
  );
  try {
    await deps.runSchemaStep({
      mode: "push",
      database,
      migrationsFolder: path.join(serverRoot(), "drizzle"),
      roleSecrets: input.roleSecrets,
      appEnv: input.appEnv,
      jobRegistry: buildJobRegistry(),
      referenceData: { currencies: iso4217 },
      logger: createLogger({
        service: "db-reset",
        release: "dev",
        level: "info",
        appEnv: input.appEnv,
        destination: { write: (line: string) => process.stderr.write(line) },
      }),
    });
  } finally {
    await database.close();
  }
  if (input.seed) {
    await deps.seed();
  }
}

export async function seedDevelopmentDatabase(
  input: { appEnv: AppEnv; superuserUrl: string; allowNonLocalHost?: boolean },
  deps: { seed: () => Promise<void> },
): Promise<void> {
  assertLocalDevelopment(
    "db:seed",
    input.appEnv,
    input.superuserUrl,
    input.allowNonLocalHost === true,
  );
  await deps.seed();
}
