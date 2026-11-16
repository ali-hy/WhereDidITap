// F-45 bootstrapOwner: the first owner's invitation, created from the CLI (F-46).
import { Temporal } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import { INVITATION_TTL } from "./constants.js";
import { isValidEmail, normaliseEmail } from "./emailAddress.js";
import type { IdentityDeps } from "./identityModule.js";
import * as invitationsRepo from "./invitationsRepo.js";
import { generateToken, hashToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";

export type BootstrapCode = "invalid_email" | "owner_exists" | "email_in_use" | "pending_exists";

/** A refusal the CLI reports; never reaches a client. */
export class BootstrapError extends Error {
  readonly code: BootstrapCode;
  readonly expiresAt: Temporal.Instant | undefined;

  constructor(code: BootstrapCode, expiresAt?: Temporal.Instant) {
    super(code);
    this.name = "BootstrapError";
    this.code = code;
    this.expiresAt = expiresAt;
  }
}

/**
 * Creates the owner's bootstrap invitation and returns its link. One transaction; no email job.
 * Replaces or expires an older bootstrap invitation and revokes other pending ones for the email.
 */
export async function bootstrapOwner(
  deps: IdentityDeps,
  input: { email: string; replace: boolean },
): Promise<{ link: string; expiresAt: Temporal.Instant; invitationId: string }> {
  const email = normaliseEmail(input.email);
  if (!isValidEmail(email)) throw new BootstrapError("invalid_email");
  const now = deps.clock.now();
  const nowDate = new Date(now.epochMilliseconds);
  const expiresAt = now.add(INVITATION_TTL);
  // Programming error: the CLI loads the API configuration.
  const publicOrigin = deps.config.api?.publicOrigin.origin;
  if (publicOrigin === undefined) throw new Error("api configuration required");
  const token = generateToken("invitation");
  const invitationId = deps.ids.next();

  await withTransaction(deps.database, async (tx) => {
    if ((await usersRepo.findOwner(tx)) !== null) throw new BootstrapError("owner_exists");
    if ((await usersRepo.findByEmail(tx, email)) !== null) {
      throw new BootstrapError("email_in_use");
    }
    const pending = await invitationsRepo.findPendingBootstrap(tx, { lock: true });
    if (pending !== null) {
      if (await invitationsRepo.expireIfDue(tx, pending.id, nowDate)) {
        await deps.events.publish(tx, "identity.invitation-ended", {
          invitationId: pending.id,
          reason: "expired",
        });
      } else if (!input.replace) {
        throw new BootstrapError(
          "pending_exists",
          Temporal.Instant.fromEpochMilliseconds(pending.expiresAt.getTime()),
        );
      } else {
        await invitationsRepo.revoke(tx, pending.id, null, nowDate);
        await deps.events.publish(tx, "identity.invitation-ended", {
          invitationId: pending.id,
          reason: "revoked",
        });
      }
    }
    for (const id of await invitationsRepo.revokePendingForEmail(tx, email, null, nowDate)) {
      await deps.events.publish(tx, "identity.invitation-ended", {
        invitationId: id,
        reason: "revoked",
      });
    }
    await invitationsRepo.insert(tx, {
      id: invitationId,
      email,
      inviterUserId: null,
      origin: "bootstrap",
      expiresAt: new Date(expiresAt.epochMilliseconds),
      tokenHash: hashToken(token),
      tokenIssuedAt: nowDate,
    });
  });

  return { link: `${publicOrigin}/invite#t=${token}`, expiresAt, invitationId };
}
