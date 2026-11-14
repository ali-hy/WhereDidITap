// F-23, F-26: creating and revoking sessions. Later slices add refresh and sign-out.
import type { Temporal } from "@budmon/shared";
import type { CommitTracker, DbHandle } from "../platform/db/types.js";
import type { ClientKind } from "../platform/http/context.js";
import { ACCESS_TTL, MAX_LIVE_SESSIONS, REFRESH_IDLE_TTL } from "./constants.js";
import type { IdentityDeps } from "./identityModule.js";
import * as knownDevicesRepo from "./knownDevicesRepo.js";
import { checkKnownDevice, issueKnownDevice } from "./knownDevicesService.js";
import * as sessionsRepo from "./sessionsRepo.js";
import type { SessionRow } from "./sessionsRepo.js";
import { generateToken, hashToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";

/** Request facts a service needs, built by the router from the RequestContext. */
export interface ReqInfo {
  ip: string;
  clientKind: ClientKind;
  userAgent: string | null;
  origin: string | null;
  host: string | undefined;
  cookies: Readonly<Record<string, string>>;
  deviceModel: string | null;
  presentedDeviceToken: string | null;
  tracker: CommitTracker;
  requestId: string;
}

export interface IssuedSession {
  sessionId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Temporal.Instant;
  refreshExpiresAt: Temporal.Instant;
  delivery: "cookie" | "bearer";
  deviceToken: string | null;
}

export type SignInOutcome =
  | { status: "signed_in"; session: IssuedSession; recoveryCodesLeft: number | null }
  | {
      status: "two_step_required";
      challengeToken: string;
      expiresAt: Temporal.Instant;
      delivery: "cookie" | "bearer";
    };

export type RevokeReason =
  | "sign_out"
  | "revoked_by_user"
  | "other_devices"
  | "limit"
  | "reuse_detected"
  | "password_reset"
  | "password_changed"
  | "two_step_enabled"
  | "deletion"
  | "owner_deletion"
  | "ban"
  | "two_step_reset_by_owner";

const toDate = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);

/** Inside the caller's transaction: the session, its first refresh token and a known device. */
export async function createSession(
  deps: IdentityDeps,
  h: DbHandle,
  input: {
    userId: string;
    delivery: "cookie" | "bearer";
    clientKind: ClientKind;
    deviceLabel: string;
    authMethod: SessionRow["authMethod"];
    presentedDeviceToken: string | null;
  },
): Promise<IssuedSession> {
  const now = deps.clock.now();
  const accessToken = generateToken("access");
  const refreshToken = generateToken("refresh");
  const sessionId = deps.ids.next();
  const refreshId = deps.ids.next();
  const accessExpiresAt = now.add(ACCESS_TTL);
  const idleExpiresAt = now.add(REFRESH_IDLE_TTL);

  await sessionsRepo.insertSession(h, {
    id: sessionId,
    userId: input.userId,
    delivery: input.delivery,
    clientKind: input.clientKind,
    deviceLabel: input.deviceLabel,
    authMethod: input.authMethod,
    accessTokenHash: hashToken(accessToken),
    accessExpiresAt: toDate(accessExpiresAt),
    currentRefreshId: refreshId,
    idleExpiresAt: toDate(idleExpiresAt),
    confirmedAt: toDate(now),
    lastUsedAt: toDate(now),
  });
  await sessionsRepo.insertRefresh(h, {
    id: refreshId,
    sessionId,
    parentId: null,
    generation: 1,
    tokenHash: hashToken(refreshToken),
    issuedAt: toDate(now),
  });

  // Keep MAX_LIVE_SESSIONS: the new session is the most recent, so the oldest go.
  const live = await sessionsRepo.listLive(h, input.userId, toDate(now));
  for (const old of live.slice(MAX_LIVE_SESSIONS)) {
    await sessionsRepo.revoke(h, old.id, "limit", toDate(now));
  }

  const user = await usersRepo.findById(h, input.userId);
  const known =
    user === null ? null : await checkKnownDevice(deps, h, input.presentedDeviceToken, user.email);
  let deviceToken: string | null = null;
  if (known !== null) {
    await knownDevicesRepo.touch(h, known.id, toDate(now));
  } else {
    deviceToken = await issueKnownDevice(deps, h, input.userId);
  }

  await usersRepo.touchLastActive(h, input.userId, toDate(now));

  return {
    sessionId,
    userId: input.userId,
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt: idleExpiresAt,
    delivery: input.delivery,
    deviceToken,
  };
}

export function revokeSessionTx(
  _deps: IdentityDeps,
  h: DbHandle,
  sessionId: string,
  reason: RevokeReason,
  at: Temporal.Instant,
): Promise<boolean> {
  return sessionsRepo.revoke(h, sessionId, reason, toDate(at));
}

export function revokeAllSessionsTx(
  _deps: IdentityDeps,
  h: DbHandle,
  userId: string,
  reason: RevokeReason,
  at: Temporal.Instant,
  exceptSessionId?: string,
): Promise<number> {
  return sessionsRepo.revokeAllForUser(h, userId, reason, toDate(at), exceptSessionId);
}
