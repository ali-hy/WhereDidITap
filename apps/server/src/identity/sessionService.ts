// F-23, F-25, F-26, F-53, F-54: creating, refreshing, listing and revoking sessions.
import { Temporal } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import type { CommitTracker, DbHandle } from "../platform/db/types.js";
import { ConflictError, NotFoundError } from "../platform/errors/platformErrors.js";
import type { ClientKind, Principal } from "../platform/http/context.js";
import {
  ACCESS_TTL,
  MAX_LIVE_SESSIONS,
  REFRESH_IDLE_TTL,
  REFRESH_RACE_WINDOW,
} from "./constants.js";
import { RefreshInvalidError } from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import * as knownDevicesRepo from "./knownDevicesRepo.js";
import { checkKnownDevice, issueKnownDevice } from "./knownDevicesService.js";
import { hitLimits } from "./limits.js";
import { recordSecurityEvent } from "./securityEventsService.js";
import * as sessionsRepo from "./sessionsRepo.js";
import type { SessionRow } from "./sessionsRepo.js";
import { generateToken, hashToken, parseToken } from "./tokens.js";
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
const instant = (d: Date): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(d.getTime());

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

const WINDOW_MS = REFRESH_RACE_WINDOW.total("milliseconds");

type RefreshOutcome =
  { kind: "issued"; session: IssuedSession } | { kind: "invalid" } | { kind: "reuse" };

/**
 * F-25: rotates a refresh token (R1 current, R2 benign predecessor, R3 race re-issue) or refuses
 * it (R3b, R4). Reuse revokes the session, and the error is thrown after that commits.
 */
export async function refreshSession(
  deps: IdentityDeps,
  input: {
    refreshToken: string | null;
    channel: "cookie" | "bearer";
    req: ReqInfo;
  },
): Promise<IssuedSession> {
  const fail = (key: string): never => {
    deps.metrics.refreshes.add(1, { error_key: key });
    throw new RefreshInvalidError();
  };
  const token = parseToken("refresh", input.refreshToken);
  if (token === null) return fail("REFRESH_INVALID");
  await hitLimits(deps, [{ limiter: "refresh.ip", subject: input.req.ip }]);

  const outcome = await withTransaction(
    deps.database,
    async (tx): Promise<RefreshOutcome> => {
      const found = await sessionsRepo.findRefreshByHashForUpdate(tx, hashToken(token));
      if (found === null) return { kind: "invalid" };
      const { token: t, session } = found;
      const now = deps.clock.now();
      const nowMs = now.epochMilliseconds;
      if (
        session.revokedAt !== null ||
        session.idleExpiresAt.getTime() <= nowMs ||
        session.delivery !== input.channel
      ) {
        return { kind: "invalid" };
      }
      await hitLimits(deps, [{ limiter: "refresh.session", subject: session.id }]);

      const c = await sessionsRepo.findRefreshById(tx, session.currentRefreshId);
      if (c === null) return { kind: "invalid" };
      const nowDate = new Date(nowMs);

      let rule: "R1" | "R2" | "R3" | null = null;
      if (t.id === c.id) rule = "R1";
      else if (t.id === c.parentId) rule = "R2";
      else if (
        t.firstPresentedAt === null &&
        t.supersededReason === "discarded" &&
        t.supersededAt !== null &&
        t.supersededAt.getTime() - t.issuedAt.getTime() <= WINDOW_MS &&
        nowMs - t.supersededAt.getTime() <= WINDOW_MS
      ) {
        // R3b: the sibling's branch moved on, so nothing is revoked.
        if (c.parentId !== t.parentId) return { kind: "invalid" };
        rule = "R3";
      }

      if (rule === null) {
        await revokeSessionTx(deps, tx, session.id, "reuse_detected", now);
        await recordSecurityEvent(deps, tx, {
          userId: session.userId,
          kind: "refresh_reuse_detected",
          sessionId: session.id,
          clientKind: session.clientKind,
          email: "session_reuse_signed_out",
          refId: session.id,
        });
        return { kind: "reuse" };
      }

      if (rule === "R1") {
        await sessionsRepo.markRefresh(tx, t.id, {
          firstPresentedAt: nowDate,
          supersededAt: nowDate,
          supersededReason: "rotated",
        });
      } else {
        await sessionsRepo.markRefresh(tx, c.id, {
          supersededAt: nowDate,
          supersededReason: "discarded",
        });
        if (rule === "R3") {
          await sessionsRepo.markRefresh(tx, t.id, {
            firstPresentedAt: nowDate,
            supersededReason: "rotated",
          });
        }
      }

      const accessToken = generateToken("access");
      const refreshToken = generateToken("refresh");
      const refreshId = deps.ids.next();
      const accessExpiresAt = now.add(ACCESS_TTL);
      const idleExpiresAt = now.add(REFRESH_IDLE_TTL);
      await sessionsRepo.insertRefresh(tx, {
        id: refreshId,
        sessionId: session.id,
        parentId: t.id,
        generation: t.generation + 1,
        tokenHash: hashToken(refreshToken),
        issuedAt: nowDate,
      });
      await sessionsRepo.rotate(tx, session.id, {
        accessTokenHash: hashToken(accessToken),
        accessExpiresAt: toDate(accessExpiresAt),
        currentRefreshId: refreshId,
        idleExpiresAt: toDate(idleExpiresAt),
        lastUsedAt: nowDate,
      });
      await usersRepo.touchLastActive(tx, session.userId, nowDate);
      return {
        kind: "issued",
        session: {
          sessionId: session.id,
          userId: session.userId,
          accessToken,
          refreshToken,
          accessExpiresAt,
          refreshExpiresAt: idleExpiresAt,
          delivery: session.delivery,
          deviceToken: null,
        },
      };
    },
    { tracker: input.req.tracker },
  );

  if (outcome.kind === "issued") {
    deps.metrics.refreshes.add(1, { error_key: "none" });
    return outcome.session;
  }
  if (outcome.kind === "reuse") deps.metrics.refreshReuse.add(1, {});
  return fail("REFRESH_INVALID");
}

/** F-53: revokes the principal's session; idempotent. */
export async function signOut(deps: IdentityDeps, principal: Principal): Promise<void> {
  await withTransaction(deps.database, async (tx) => {
    await revokeSessionTx(deps, tx, principal.sessionId, "sign_out", deps.clock.now());
  });
}

export interface SessionListItem {
  id: string;
  deviceLabel: string;
  clientKind: ClientKind;
  createdAt: Temporal.Instant;
  lastUsedAt: Temporal.Instant;
  current: boolean;
}

/** F-54: the user's live sessions, the current one first, then by last use. */
export async function listSessions(
  deps: IdentityDeps,
  principal: Principal,
): Promise<readonly SessionListItem[]> {
  const now = toDate(deps.clock.now());
  const rows = await sessionsRepo.listLive(deps.database.handle, principal.userId, now);
  const items = rows.map((r) => ({
    id: r.id,
    deviceLabel: r.deviceLabel,
    clientKind: r.clientKind,
    createdAt: instant(r.createdAt),
    lastUsedAt: instant(r.lastUsedAt),
    current: r.id === principal.sessionId,
  }));
  return [...items.filter((i) => i.current), ...items.filter((i) => !i.current)];
}

/** F-54: revokes another of the user's own sessions. */
export async function revokeOwnSession(
  deps: IdentityDeps,
  principal: Principal,
  sessionId: string,
): Promise<void> {
  await withTransaction(deps.database, async (tx) => {
    const target = await sessionsRepo.findById(tx, sessionId, { lock: true });
    if (target === null || target.userId !== principal.userId || target.revokedAt !== null) {
      throw new NotFoundError();
    }
    if (target.id === principal.sessionId) throw new ConflictError({ reason: "current_session" });
    await revokeSessionTx(deps, tx, target.id, "revoked_by_user", deps.clock.now());
    await recordSecurityEvent(deps, tx, {
      userId: principal.userId,
      kind: "session_revoked",
      sessionId: principal.sessionId,
    });
  });
}

/** F-54: revokes every other session of the user, with one event. */
export async function revokeOtherSessions(
  deps: IdentityDeps,
  principal: Principal,
): Promise<{ revoked: number }> {
  return withTransaction(deps.database, async (tx) => {
    const revoked = await revokeAllSessionsTx(
      deps,
      tx,
      principal.userId,
      "other_devices",
      deps.clock.now(),
      principal.sessionId,
    );
    if (revoked > 0) {
      await recordSecurityEvent(deps, tx, {
        userId: principal.userId,
        kind: "session_revoked",
        sessionId: principal.sessionId,
      });
    }
    return { revoked };
  });
}
