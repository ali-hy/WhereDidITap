// F-144: deletes exports older than 7 days.
import type { Clock } from "@budmon/shared";
import type { Logger } from "../observability/logger.js";
import type { ObjectStore } from "./objectStore.js";

export async function purgeExpiredExports(deps: {
  store: ObjectStore;
  clock: Clock;
  logger: Logger;
}): Promise<number> {
  const cutoff = deps.clock.now().subtract({ hours: 7 * 24 });
  const expired: string[] = [];
  for await (const entry of deps.store.list("exports", "users/")) {
    if (entry.lastModified.epochNanoseconds < cutoff.epochNanoseconds) expired.push(entry.key);
  }
  for (const key of expired) await deps.store.delete("exports", key);
  deps.logger.info("exports_purged", { count: expired.length });
  return expired.length;
}
