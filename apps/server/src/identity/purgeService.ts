// F-130: the hourly purge of expired and ended identity rows.
import type { Temporal } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import type { DbHandle } from "../platform/db/types.js";
import {
  ENDED_INVITATION_RETENTION,
  ENDED_SESSION_RETENTION,
  EXPORT_ROW_RETENTION,
  REFRESH_PRUNE_AGE,
  SECURITY_EVENT_RETENTION,
} from "./constants.js";
import * as challengesRepo from "./challengesRepo.js";
import * as exportsRepo from "./exportsRepo.js";
import type { IdentityDeps } from "./identityModule.js";
import * as invitationsRepo from "./invitationsRepo.js";
import * as knownDevicesRepo from "./knownDevicesRepo.js";
import * as resetsRepo from "./resetsRepo.js";
import * as securityEventsRepo from "./securityEventsRepo.js";
import * as sessionsRepo from "./sessionsRepo.js";
import * as twoStepRepo from "./twoStepRepo.js";

const BATCH = 5000;

/** Runs `batch` in its own transaction until one returns fewer than BATCH rows. */
async function inBatches(
  deps: IdentityDeps,
  batch: (tx: DbHandle) => Promise<number>,
): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await withTransaction(deps.database, batch);
    total += n;
    if (n < BATCH) return total;
  }
}

/** Each step's count, in the order the steps ran. */
export async function runIdentityPurge(deps: IdentityDeps): Promise<Record<string, number>> {
  const now = deps.clock.now();
  const at = (offset?: Temporal.DurationLike): Date =>
    new Date((offset === undefined ? now : now.subtract(offset)).epochMilliseconds);
  const counts: Record<string, number> = {};
  const step = async (name: string, batch: (tx: DbHandle) => Promise<number>): Promise<void> => {
    const count = await inBatches(deps, batch);
    counts[name] = count;
    deps.logger.info("identity_purged", { step: name, count });
  };

  await step("invitations_expired", async (tx) => {
    const ids = await invitationsRepo.expireAllDue(tx, at(), BATCH);
    for (const invitationId of ids) {
      await deps.events.publish(tx, "identity.invitation-ended", {
        invitationId,
        reason: "expired",
      });
    }
    return ids.length;
  });
  await step("challenges", (tx) => challengesRepo.purge(tx, at({ hours: 1 }), BATCH));
  await step("resets", (tx) => resetsRepo.purge(tx, at({ hours: 24 }), BATCH));
  await step("refresh_tokens", (tx) =>
    sessionsRepo.pruneRefreshTokens(tx, at(REFRESH_PRUNE_AGE), BATCH),
  );
  await step("sessions", (tx) => sessionsRepo.purgeEnded(tx, at(ENDED_SESSION_RETENTION), BATCH));
  await step("invitations_ended", (tx) =>
    invitationsRepo.purgeEnded(tx, at(ENDED_INVITATION_RETENTION), BATCH),
  );
  await step("security_events", (tx) =>
    securityEventsRepo.purge(tx, at(SECURITY_EVENT_RETENTION), BATCH),
  );
  await step("exports", async (tx) => {
    const expired = await exportsRepo.expireDue(tx, at(), BATCH);
    const purged = await exportsRepo.purge(tx, at(EXPORT_ROW_RETENTION), BATCH);
    return expired + purged;
  });
  await step("two_step_pending", (tx) => twoStepRepo.purgeExpiredPending(tx, at(), BATCH));
  await step("known_devices", (tx) => knownDevicesRepo.purgeExpired(tx, at(), BATCH));
  return counts;
}
