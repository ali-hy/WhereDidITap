// F-46: the `identity:bootstrap-owner` command (dispatched from main/cli.ts).
import { readFileSync } from "node:fs";
import { toInstantWire, type Temporal } from "@budmon/shared";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";
import { createApiContainer } from "../platform/container.js";
import { describeFailure } from "../platform/observability/describeFailure.js";
import { cliLogger } from "../platform/observability/cliLogger.js";
import { BootstrapError, bootstrapOwner } from "./bootstrapService.js";

const EXIT_USAGE = 64;
const USAGE_LINE = "Usage: identity:bootstrap-owner --email <address> [--replace]";

interface Io {
  stdout(line: string): void;
  stderr(line: string): void;
}

/** `--email <value>` once and `--replace` at most once, in any order; otherwise null. */
function parseArgs(args: readonly string[]): { email: string; replace: boolean } | null {
  let email: string | undefined;
  let replace = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--email" && email === undefined && args[i + 1] !== undefined) {
      email = args[i + 1];
      i += 1;
    } else if (arg === "--replace" && !replace) {
      replace = true;
    } else {
      return null;
    }
  }
  return email === undefined ? null : { email, replace };
}

function refusal(error: BootstrapError): string {
  const expires = (at: Temporal.Instant | undefined) => (at === undefined ? "" : toInstantWire(at));
  switch (error.code) {
    case "owner_exists":
      return "An owner already exists.";
    case "pending_exists":
      return `An owner invitation is already waiting (expires ${expires(error.expiresAt)}). Run again with --replace to cancel it and create a new link.`;
    case "email_in_use":
      return "That email already belongs to a user.";
    case "invalid_email":
      return "Enter a valid email address.";
  }
}

/** Exit codes: 0 created, 1 refused or failed, 64 usage, 78 configuration. */
export async function runBootstrapOwnerCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
  deps: { createContainer?: typeof createApiContainer } = {},
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === null) {
    io.stderr(USAGE_LINE);
    return EXIT_USAGE;
  }
  const config = loadConfigOrReport("api", env, readFileSync, (line) => {
    io.stderr(line);
  });
  if (config === null) return EXIT_CONFIG;
  const logger = cliLogger(config);
  const container = (deps.createContainer ?? createApiContainer)(config, { logger });
  try {
    // The event job needs the send-only pg-boss, which main/api.ts otherwise starts.
    await container.boss.start();
    const result = await bootstrapOwner(container.identity.deps, parsed);
    io.stdout(
      `Owner invitation created. Open this link within 7 days (expires ${toInstantWire(result.expiresAt)}):`,
    );
    io.stdout(result.link);
    io.stdout(
      "If this link may have been seen or copied by someone else, run the command again with --replace.",
    );
    logger.info("bootstrap_owner_created", { entityId: result.invitationId });
    return 0;
  } catch (error) {
    if (error instanceof BootstrapError) {
      io.stderr(refusal(error));
      return 1;
    }
    logger.error("cli_failed", describeFailure(error));
    return 1;
  } finally {
    await container.close();
  }
}
