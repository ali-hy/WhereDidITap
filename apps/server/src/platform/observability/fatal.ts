// A-118: the process's last word on an unhandled rejection or an uncaught exception. Only F-31's
// sanitised form of the error is written; the reporter is flushed; the process exits 1 and the
// container restarts it.
import { RELEASE_PATTERN } from "../config/schema.js";
import { describeFailure } from "./describeFailure.js";
import type { ErrorReporter } from "./errorReporter.js";
import { createLogger, type DestinationStream, type Logger } from "./logger.js";

export interface FatalState {
  logger: Logger;
  reporter: ErrorReporter;
}

const noReporter: ErrorReporter = { report: () => undefined, flush: () => Promise.resolve() };

/** The logger used before the configuration is loaded (A-115): the release only if it's valid. */
export function startupState(
  service: string,
  env: Readonly<Record<string, string | undefined>>,
  opts: { destination?: DestinationStream } = {},
): FatalState {
  const raw = env["BUDMON_RELEASE"];
  const release = raw !== undefined && RELEASE_PATTERN.test(raw) ? raw : "dev";
  return {
    logger: createLogger({
      service,
      release,
      level: "info",
      ...(opts.destination === undefined ? {} : { destination: opts.destination }),
    }),
    reporter: noReporter,
  };
}

export function installFatalHandlers(
  state: FatalState,
  exit: (code: number) => void = (code) => process.exit(code),
  target: Pick<NodeJS.EventEmitter, "on"> = process,
): void {
  const fatal = async (event: string, error: unknown): Promise<void> => {
    state.logger.error(event, describeFailure(error), error);
    try {
      await state.reporter.flush(2000);
    } catch {
      // Exiting matters more than the report.
    }
    exit(1);
  };
  target.on("unhandledRejection", (reason) => {
    void fatal("unhandled_rejection", reason);
  });
  target.on("uncaughtException", (error) => {
    void fatal("uncaught_exception", error);
  });
}
