// Start-up handling shared by the process entry points (F-90 to F-92).
import { ConfigError, describeConfigError, loadConfig } from "./loadConfig.js";
import type { Config, ProcessKind } from "./schema.js";

/** Exit code for an invalid configuration (F-11). */
export const EXIT_CONFIG = 78;

/** Loads the configuration, or prints the problems (names only) and returns `null`. */
export function loadConfigOrReport(
  kind: ProcessKind,
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => Buffer,
  stderr: (line: string) => void,
): Config | null {
  try {
    return loadConfig(kind, env, readFile);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const line of describeConfigError(error)) stderr(line);
    return null;
  }
}
