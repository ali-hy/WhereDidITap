// F-40 previewInvitation and F-41 acceptInvitation (the password method; Google arrives in S-6).
import { Temporal, toInstantWire } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import type { DbHandle } from "../platform/db/types.js";
import { BudmonError } from "../platform/errors/BudmonError.js";
import { ValidationFailedError } from "../platform/errors/platformErrors.js";
import { DEFAULT_INVITE_ALLOWANCE, RECENT_ACCEPT_WINDOW } from "./constants.js";
import * as bansRepo from "./bansRepo.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { deviceLabelFor } from "./deviceLabel.js";
import {
  GoogleUnavailableError,
  InvitationExpiredError,
  InvitationInvalidError,
  InvitationRevokedError,
  InvitationUsedError,
  PasswordTooWeakError,
  UserCapReachedError,
} from "./identityErrors.js";
import { identityJobs } from "./identityJobs.js";
import type { IdentityDeps } from "./identityModule.js";
import * as invitationsRepo from "./invitationsRepo.js";
import type { InvitationRow } from "./invitationsRepo.js";
import { hitLimits } from "./limits.js";
import { checkPassword } from "./passwordPolicy.js";
import { validateProfile, type ProfileFields } from "./profileService.js";
import { recordSecurityEvent } from "./securityEventsService.js";
import { createSession, type IssuedSession, type ReqInfo } from "./sessionService.js";
import * as settingsRepo from "./settingsRepo.js";
import { hashToken, parseToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";

export interface InvitationPreview {
  invitationId: string;
  email: string;
  inviterName: string | null;
  expiresAt: Temporal.Instant;
  origin: "direct" | "account_share" | "bootstrap";
}

const toDate = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);
const instant = (d: Date): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(d.getTime());

type AnyError = BudmonError<Record<string, unknown> | undefined>;
type Checked = { ok: true; invitation: InvitationRow } | { ok: false; error: AnyError };

/**
 * F-40's checks 3 to 6 inside the caller's transaction: lock the invitation, flip an overdue one
 * to expired (publishing the event) and apply the status and ban rules. A failure is returned,
 * not thrown, so the caller commits the flip before it throws.
 */
async function lockAndCheck(deps: IdentityDeps, tx: DbHandle, token: string): Promise<Checked> {
  const invitation = await invitationsRepo.findByTokenHash(tx, hashToken(token), { lock: true });
  if (invitation === null) return { ok: false, error: new InvitationInvalidError() };
  const now = toDate(deps.clock.now());
  if (await invitationsRepo.expireIfDue(tx, invitation.id, now)) {
    await deps.events.publish(tx, "identity.invitation-ended", {
      invitationId: invitation.id,
      reason: "expired",
    });
    return {
      ok: false,
      error: new InvitationExpiredError(toInstantWire(instant(invitation.expiresAt))),
    };
  }
  switch (invitation.status) {
    case "expired":
      return {
        ok: false,
        error: new InvitationExpiredError(toInstantWire(instant(invitation.expiresAt))),
      };
    case "revoked":
      return { ok: false, error: new InvitationRevokedError() };
    case "accepted": {
      const since = deps.clock.now().subtract(RECENT_ACCEPT_WINDOW).epochMilliseconds;
      return {
        ok: false,
        error: new InvitationUsedError(
          invitation.acceptedAt !== null && invitation.acceptedAt.getTime() >= since,
        ),
      };
    }
    case "pending":
      break;
  }
  if (await bansRepo.isBanned(tx, invitation.email)) {
    return { ok: false, error: new InvitationInvalidError() };
  }
  return { ok: true, invitation };
}

export async function previewInvitation(
  deps: IdentityDeps,
  input: { token: string },
  req: ReqInfo,
): Promise<InvitationPreview> {
  await hitLimits(deps, [{ limiter: "token.ip", subject: req.ip }]);
  const token = parseToken("invitation", input.token);
  if (token === null) throw new InvitationInvalidError();

  const result = await withTransaction(
    deps.database,
    async (tx) => {
      const checked = await lockAndCheck(deps, tx, token);
      if (!checked.ok) return checked;
      const { invitation } = checked;
      const inviter =
        invitation.inviterUserId === null
          ? null
          : await usersRepo.findById(tx, invitation.inviterUserId);
      return {
        ok: true as const,
        preview: {
          invitationId: invitation.id,
          email: invitation.email,
          inviterName: inviter?.displayName ?? null,
          expiresAt: instant(invitation.expiresAt),
          origin: invitation.origin,
        } satisfies InvitationPreview,
      };
    },
    { tracker: req.tracker },
  );
  if (!result.ok) throw result.error;
  return result.preview;
}

export interface AcceptInput extends ProfileFieldsRequired {
  token: string;
  method: { kind: "password"; password: string } | { kind: "google"; ticket: string };
  delivery: "cookie" | "bearer";
  presentedDeviceToken: string | null;
}

interface ProfileFieldsRequired {
  displayName: string;
  locale: string;
  timeZone: string;
  baseCurrency: string;
}

/** A second owner's insert hits the partial unique index on `is_product_owner`. */
const isSingleOwnerViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "23505" &&
  (e as { constraint?: unknown }).constraint === "users_single_owner";

export async function acceptInvitation(
  deps: IdentityDeps,
  input: AcceptInput,
  req: ReqInfo,
): Promise<IssuedSession> {
  try {
    const session = await accept(deps, input, req);
    deps.metrics.signIns.add(1, { method: "sign_up", error_key: "none" });
    return session;
  } catch (e) {
    deps.metrics.signIns.add(1, {
      method: "sign_up",
      error_key: e instanceof BudmonError ? e.key : "INTERNAL",
    });
    throw e;
  }
}

async function accept(
  deps: IdentityDeps,
  input: AcceptInput,
  req: ReqInfo,
): Promise<IssuedSession> {
  await hitLimits(deps, [{ limiter: "token.ip", subject: req.ip }]);
  const token = parseToken("invitation", input.token);
  if (token === null) throw new InvitationInvalidError();

  const profile: ProfileFields = {
    displayName: input.displayName,
    locale: input.locale,
    timeZone: input.timeZone,
    baseCurrency: input.baseCurrency,
  };
  const { value, issues } = await validateProfile(deps, deps.database.handle, profile);
  if (issues.length > 0) throw new ValidationFailedError(issues);

  if (input.method.kind !== "password") throw new GoogleUnavailableError();

  // The password is checked and hashed before the main transaction, which holds locks.
  const pending = await invitationsRepo.findByTokenHash(deps.database.handle, hashToken(token));
  if (pending === null) throw new InvitationInvalidError();
  const problem = checkPassword(input.method.password, pending.email, deps.commonPasswords());
  if (problem !== null) throw new PasswordTooWeakError(problem);
  const hash = await deps.hasher.hash(input.method.password);

  const result = await createUser(deps, input, req, token, value as ProfileFieldsRequired, hash);
  if (result.kind === "failed") throw result.error;
  if (result.kind === "cap") {
    await notifyCapReached(deps, result.invitation);
    throw new UserCapReachedError();
  }
  return result.session;
}

type CreateResult =
  | { kind: "created"; session: IssuedSession }
  | { kind: "failed"; error: AnyError }
  | { kind: "cap"; invitation: InvitationRow };

async function createUser(
  deps: IdentityDeps,
  input: AcceptInput,
  req: ReqInfo,
  token: string,
  profile: ProfileFieldsRequired,
  passwordHash: string,
): Promise<CreateResult> {
  try {
    return await withTransaction(
      deps.database,
      async (tx): Promise<CreateResult> => {
        const checked = await lockAndCheck(deps, tx, token);
        if (!checked.ok) return { kind: "failed", error: checked.error };
        const { invitation } = checked;

        const settings = await settingsRepo.getForUpdate(tx);
        if ((await usersRepo.findByEmail(tx, invitation.email)) !== null) {
          return { kind: "failed", error: new InvitationUsedError(false) };
        }
        if ((await usersRepo.countAll(tx)) + 1 > settings.userCap) {
          return { kind: "cap", invitation };
        }

        const now = toDate(deps.clock.now());
        const userId = deps.ids.next();
        const bootstrap = invitation.origin === "bootstrap";
        await usersRepo.insert(tx, {
          id: userId,
          email: invitation.email,
          emailVerifiedAt: now,
          displayName: profile.displayName,
          locale: profile.locale,
          timeZone: profile.timeZone,
          baseCurrency: profile.baseCurrency,
          status: "active",
          deletionRequestedAt: null,
          deletionScheduledFor: null,
          deletionRequestedBy: null,
          isProductOwner: false,
          inviteAllowance: bootstrap ? null : DEFAULT_INVITE_ALLOWANCE,
          invitedByUserId: invitation.inviterUserId,
        });
        if (bootstrap) await usersRepo.setOwner(tx, userId);
        await credentialsRepo.upsertPassword(tx, userId, passwordHash);
        await invitationsRepo.markAccepted(tx, invitation.id, userId, now);

        const session = await createSession(deps, tx, {
          userId,
          delivery: input.delivery,
          clientKind: req.clientKind,
          deviceLabel: deviceLabelFor(req.clientKind, req.userAgent, req.deviceModel),
          authMethod: "sign_up",
          presentedDeviceToken: input.presentedDeviceToken,
        });
        await recordSecurityEvent(deps, tx, {
          userId,
          kind: "sign_up",
          sessionId: session.sessionId,
          clientKind: req.clientKind,
        });
        await deps.events.publish(tx, "identity.user-created", {
          userId,
          invitationId: invitation.id,
        });
        return { kind: "created", session };
      },
      { tracker: req.tracker },
    );
  } catch (e) {
    if (isSingleOwnerViolation(e)) return { kind: "failed", error: new InvitationRevokedError() };
    throw e;
  }
}

/** One email per recipient, in its own transaction, so the notice outlives the refused sign-up. */
async function notifyCapReached(deps: IdentityDeps, invitation: InvitationRow): Promise<void> {
  await withTransaction(deps.database, async (tx) => {
    const send = (recipient: "inviter" | "owner") =>
      deps.queue.enqueue(tx, identityJobs.emailSend, {
        kind: "invitation_cap_failed",
        refId: invitation.id,
        recipient,
      });
    if (invitation.inviterUserId !== null) await send("inviter");
    const owner = await usersRepo.findOwner(tx);
    if (owner !== null && owner.id !== invitation.inviterUserId) await send("owner");
  });
}
