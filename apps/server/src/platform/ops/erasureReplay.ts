// F-151: re-applies logged erasures, for example after a restore from a backup older than them.
import type { Temporal } from "@budmon/shared";
import { describeFailure } from "../observability/describeFailure.js";
import type { Logger } from "../observability/logger.js";
import type { ErasureHandler, ErasureLog } from "../storage/erasureLog.js";

export class NoErasureHandlerError extends Error {
  constructor() {
    super("no erasure handler registered");
    this.name = "NoErasureHandlerError";
  }
}

export async function replayErasures(
  deps: { log: ErasureLog; handler: ErasureHandler | null; logger: Logger },
  since: Temporal.Instant,
): Promise<{ replayed: number }> {
  const records = await deps.log.listSince(since);
  if (records.length > 0 && deps.handler === null) throw new NoErasureHandlerError();
  let replayed = 0;
  for (const record of records) {
    try {
      // Checked above: a handler exists whenever there are records.
      await (deps.handler as ErasureHandler)(record.userId);
    } catch (error) {
      // A-295: the count completed so far, never the user id.
      deps.logger.error(
        "erasure_replay_failed",
        { count: replayed, ...describeFailure(error) },
        error,
      );
      throw error;
    }
    replayed += 1;
  }
  deps.logger.info("erasure_replayed", { count: replayed });
  return { replayed };
}
