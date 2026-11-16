// F-79: the worker's heartbeat, read by the healthcheck entry (F-175) and exported as a gauge.
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Clock } from "@budmon/shared";
import type { Logger } from "../observability/logger.js";
import type { PlatformMetrics } from "../observability/metrics.js";

export const DEFAULT_HEARTBEAT_FILE = "/tmp/heartbeat";

interface HeartbeatPathOptions {
  platform?: NodeJS.Platform;
  tmpdir?: () => string;
}

/** The default path: `/tmp/heartbeat`, or `<tmpdir>\heartbeat` on Windows (A-518). */
export function defaultHeartbeatFile(opts: HeartbeatPathOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  return platform === "win32"
    ? path.win32.join((opts.tmpdir ?? os.tmpdir)(), "heartbeat")
    : DEFAULT_HEARTBEAT_FILE;
}

/**
 * A-226: `HEARTBEAT_FILE` when it's an absolute path on the platform, else the default.
 * Read directly, not through Config, so the healthcheck needn't load the configuration.
 */
export function heartbeatFile(
  env: Readonly<Record<string, string | undefined>>,
  opts: HeartbeatPathOptions = {},
): string {
  const value = env["HEARTBEAT_FILE"];
  const platformPath = (opts.platform ?? process.platform) === "win32" ? path.win32 : path.posix;
  return value !== undefined && value !== "" && platformPath.isAbsolute(value)
    ? value
    : defaultHeartbeatFile(opts);
}

export function startHeartbeat(deps: {
  metrics: PlatformMetrics;
  logger: Logger;
  clock: Clock;
  service: string;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  writeFile?: (path: string, data: string) => void;
  path?: string;
}): { stop(): void; last(): number } {
  const file = deps.path ?? defaultHeartbeatFile();
  const write =
    deps.writeFile ??
    ((p: string, data: string) => {
      writeFileSync(p, data);
    });
  let last = 0;
  let warned = false;
  const beat = (): void => {
    last = deps.clock.now().epochMilliseconds / 1000;
    try {
      write(file, String(Math.floor(last)));
    } catch {
      if (!warned) {
        warned = true;
        deps.logger.warn("heartbeat_write_failed");
      }
    }
  };
  beat();
  const timer = (deps.setInterval ?? setInterval)(beat, deps.intervalMs ?? 15_000);
  deps.metrics.observeWorkerHeartbeat(() => [{ value: last, labels: { service: deps.service } }]);
  return {
    stop: () => {
      if (typeof timer === "object" && timer !== null && "unref" in timer) {
        clearInterval(timer as NodeJS.Timeout);
      } else if (typeof timer === "number") {
        clearInterval(timer);
      }
    },
    last: () => last,
  };
}
