// The operator commands' logger: JSON lines on stderr, so stdout carries only the command's output.
import type { Config } from "../platform/config/schema.js";
import { createLogger } from "../platform/observability/logger.js";

export function cliLogger(config: Config) {
  return createLogger({
    service: "cli",
    release: config.release,
    level: config.logLevel,
    appEnv: config.appEnv,
    destination: { write: (line: string) => process.stderr.write(line) },
  });
}
