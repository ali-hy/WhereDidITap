// F-56: the X-Budmon-Client header and the minimum-version check.
import type { Config } from "../config/schema.js";
import { ClientUpdateRequiredError } from "../errors/platformErrors.js";
import type { PlatformMetrics } from "../observability/metrics.js";
import type { ClientKind } from "./context.js";

const HEADER = /^(android|web)\/(\d{1,10})$/;

export function parseClientHeader(value: string | undefined): {
  kind: ClientKind;
  version: number | null;
} {
  const match = value === undefined ? null : HEADER.exec(value);
  if (match === null) return { kind: "other", version: null };
  return {
    kind: match[1] === "android" ? "android" : "web",
    version: Number.parseInt(match[2] ?? "", 10),
  };
}

const EXEMPT = new Set(["meta.clientConfig"]);

/** Runs for every procedure except meta.clientConfig; `other` clients are never blocked. */
export function clientVersionMiddleware(
  versions: NonNullable<Config["api"]>["clientVersions"],
  metrics?: PlatformMetrics,
) {
  return async <T>(options: {
    next: () => Promise<T>;
    path: readonly string[];
    context: { clientKind: ClientKind; clientVersion: number | null };
  }): Promise<T> => {
    const { clientKind, clientVersion } = options.context;
    if (!EXEMPT.has(options.path.join(".")) && clientVersion !== null) {
      const minimum =
        clientKind === "android" ? versions.minAndroid : clientKind === "web" ? versions.minWeb : 0;
      if (clientVersion < minimum) {
        metrics?.clientUpdateRequired.add(1, { client_kind: clientKind });
        throw new ClientUpdateRequiredError(minimum);
      }
    }
    return options.next();
  };
}
