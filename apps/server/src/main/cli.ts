// F-93: operator commands (`node dist/main/cli.js <command>`). S-6 delivers `jobs:dead`; later
// slices add the rest of F-93's table.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Temporal, isUuid } from "@budmon/shared";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { createLogger } from "../platform/observability/logger.js";
import type { Config } from "../platform/config/schema.js";
import { createApiContainer, createWorkerContainer } from "../platform/container.js";
import { serverRoot } from "../platform/config/serverRoot.js";
import { readJournal } from "../platform/db/migrations.js";
import { NoErasureHandlerError, replayErasures } from "../platform/ops/erasureReplay.js";
import { verifyRestore } from "../platform/ops/restoreVerify.js";
import { rewrapApiSecretsCommand, captureRewrapJob } from "../platform/crypto/rewrap.js";
import { createDatabase } from "../platform/db/client.js";
import { createJobQueue } from "../platform/queue/jobQueue.js";
import { listDeadLetters, redriveDeadLetter } from "../platform/queue/deadLetter.js";
import { buildJobRegistry } from "../platform/queue/appRegistry.js";
import { createPgBoss } from "../platform/queue/workers.js";
import { installProxySupport } from "../platform/crypto/proxy.js";
import type { WorkerRole } from "../platform/queue/jobs.js";

const EXIT_USAGE = 64;
const USAGE = [
  "Usage:",
  "  secrets:rewrap-api",
  "  jobs:capture-rewrap",
  "  jobs:dead list [--role capture|general] [--limit n]",
  "  jobs:dead redrive --role capture|general --id <uuid>",
  "  restore:verify",
  "  erasure:replay --since <RFC 3339 instant>",
].join("\n");
/** F-93: restore:verify's report isn't ok. */
const EXIT_RESTORE_NOT_OK = 6;

interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function role(value: string | undefined): WorkerRole | undefined | null {
  if (value === undefined) return undefined;
  return value === "capture" || value === "general" ? value : null;
}

function cliLogger(config: Config) {
  return createLogger({
    service: "cli",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
    // stdout carries only the command's output.
    destination: { write: (line: string) => process.stderr.write(line) },
  });
}

/** F-93 secrets:rewrap-api (kind api): F-117 over the container's sealed columns. */
async function rewrapApi(
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
): Promise<number> {
  const config = loadConfigOrReport("api", env, readFileSync, io.stderr);
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  const container = createApiContainer(config, { logger });
  try {
    io.stdout(JSON.stringify(await rewrapApiSecretsCommand(container)));
    return 0;
  } catch (error) {
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await container.close();
  }
}

/** F-93 jobs:capture-rewrap (kind worker, general): enqueues F-118. */
async function captureRewrap(
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
): Promise<number> {
  const config = loadConfigOrReport(
    "worker",
    { ...env, WORKER_ROLES: "general" },
    readFileSync,
    io.stderr,
  );
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  const boss = createPgBoss(config, "cli", logger);
  const database = createDatabase(config.db, { applicationName: "budmon-cli" });
  try {
    await boss.start();
    const queue = createJobQueue({ boss, registry: buildJobRegistry() });
    await queue.enqueue(database.handle, captureRewrapJob, {});
    io.stdout(JSON.stringify({ enqueued: true }));
    return 0;
  } catch (error) {
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await boss.stop({ graceful: false });
    await database.close();
  }
}

/** F-93 restore:verify: F-150 against the configured database, as budmon_migrator. */
async function restoreVerify(
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
  migrationsFolder: string,
): Promise<number> {
  // A-289: kind migrate, connecting as the configured DB_USER (budmon_migrator).
  const config = loadConfigOrReport("migrate", env, readFileSync, io.stderr);
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  const database = createDatabase(config.db, { applicationName: "budmon-cli" });
  try {
    const report = await verifyRestore({ database, journal: readJournal(migrationsFolder) });
    io.stdout(JSON.stringify(report));
    return report.ok ? 0 : EXIT_RESTORE_NOT_OK;
  } catch (error) {
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await database.close();
  }
}

/** F-93 erasure:replay (kind worker, general): F-151 over the general worker's erasure log. */
async function erasureReplay(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
): Promise<number> {
  const sinceText = option(args, "--since");
  let since: Temporal.Instant | undefined;
  try {
    since = sinceText === undefined ? undefined : Temporal.Instant.from(sinceText);
  } catch {
    since = undefined;
  }
  // A-294: usage errors exit 64 before any configuration is read.
  if (since === undefined || args.length !== 2) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const config = loadConfigOrReport(
    "worker",
    { ...env, WORKER_ROLES: "general" },
    readFileSync,
    io.stderr,
  );
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  // No pg-boss instance is started: the container only needs its erasure log and handler.
  const container = createWorkerContainer(config, { logger });
  try {
    if (container.erasureLog === null) throw new Error("no erasure log");
    const result = await replayErasures(
      { log: container.erasureLog, handler: container.erasureHandler, logger },
      since,
    );
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error) {
    if (error instanceof NoErasureHandlerError) {
      io.stderr("No erasure handler is registered, and erasure records exist.");
      return 2;
    }
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await container.close();
  }
}

export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
  /** A-288: restore:verify's migrations folder (tests use a fixture). */
  deps: { migrationsFolder?: string } = {},
): Promise<number> {
  // F-122: first.
  installProxySupport(env);
  const [command, sub, ...args] = argv;
  if (command === "secrets:rewrap-api" && sub === undefined) return rewrapApi(env, io);
  if (command === "jobs:capture-rewrap" && sub === undefined) return captureRewrap(env, io);
  if (command === "restore:verify" && sub === undefined)
    return restoreVerify(env, io, deps.migrationsFolder ?? path.join(serverRoot(), "drizzle"));
  if (command === "erasure:replay") {
    return erasureReplay(argv.slice(1), env, io);
  }
  if (command !== "jobs:dead" || (sub !== "list" && sub !== "redrive")) {
    io.stderr(`Unknown command: ${[command, sub].filter((x) => x !== undefined).join(" ")}`);
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const r = role(option(args, "--role"));
  const limitText = option(args, "--limit");
  const id = option(args, "--id");
  if (r === null || (limitText !== undefined && !/^[1-9]\d{0,3}$/.test(limitText))) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  if (sub === "redrive" && (r === undefined || id === undefined || !isUuid(id))) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }

  // Every jobs:dead command runs as the general worker (F-93).
  const config = loadConfigOrReport(
    "worker",
    { ...env, WORKER_ROLES: "general" },
    readFileSync,
    io.stderr,
  );
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  // A-218: no supervision or schedules beside the real worker.
  const boss = createPgBoss(config, "cli", logger);
  try {
    await boss.start();
    if (sub === "list") {
      const limit = limitText === undefined ? undefined : Number.parseInt(limitText, 10);
      for (const entry of await listDeadLetters(boss, r, limit)) io.stdout(JSON.stringify(entry));
      return 0;
    }
    // Checked above: role and id are present for redrive.
    const moved = await redriveDeadLetter(
      boss,
      r as WorkerRole,
      id as string,
      buildJobRegistry(),
      logger,
    );
    io.stdout(JSON.stringify({ moved }));
    return moved === 1 ? 0 : 2;
  } catch (error) {
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await boss.stop({ graceful: false });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runCli(process.argv.slice(2), process.env, {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
