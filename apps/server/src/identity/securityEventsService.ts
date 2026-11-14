// F-20: records a security event and, optionally, the email that goes with it.
import type { DbHandle } from "../platform/db/types.js";
import type { ClientKind } from "../platform/http/context.js";
import type { SecurityEventKind } from "./constants.js";
import type { EmailKind } from "./emailTemplates.js";
import { identityJobs } from "./identityJobs.js";
import type { IdentityDeps } from "./identityModule.js";
import * as securityEventsRepo from "./securityEventsRepo.js";

/** The email job is enqueued on `h`, so the email commits with the change. */
export async function recordSecurityEvent(
  deps: IdentityDeps,
  h: DbHandle,
  e: {
    userId: string;
    kind: SecurityEventKind;
    sessionId?: string | null;
    clientKind?: ClientKind | null;
    email?: EmailKind | null;
    refId?: string;
  },
): Promise<void> {
  const eventId = deps.ids.next();
  await securityEventsRepo.insert(h, {
    id: eventId,
    userId: e.userId,
    kind: e.kind,
    sessionId: e.sessionId ?? null,
    clientKind: e.clientKind ?? null,
  });
  if (e.email !== undefined && e.email !== null) {
    await deps.queue.enqueue(h, identityJobs.emailSend, {
      kind: e.email,
      refId: e.refId ?? e.userId,
      eventId,
    });
  }
  deps.logger.info("security_event", { userId: e.userId, reason: e.kind });
}
