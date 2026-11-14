// F-11: sessions and their refresh-token families.
import type { DbHandle } from "../platform/db/types.js";
import type { ClientKind } from "../platform/http/context.js";

export interface SessionRow {
  id: string;
  userId: string;
  delivery: "cookie" | "bearer";
  clientKind: ClientKind;
  deviceLabel: string;
  authMethod: "password" | "google" | "reset" | "sign_up";
  accessExpiresAt: Date;
  currentRefreshId: string;
  idleExpiresAt: Date;
  confirmedAt: Date | null;
  lastUsedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
}

export interface RefreshRow {
  id: string;
  sessionId: string;
  parentId: string | null;
  generation: number;
  issuedAt: Date;
  firstPresentedAt: Date | null;
  supersededAt: Date | null;
  supersededReason: "rotated" | "discarded" | null;
}

const SESSION_COLUMNS = `id, user_id, delivery, client_kind, device_label, auth_method, access_expires_at,
  current_refresh_id, idle_expires_at, confirmed_at, last_used_at, revoked_at, revoke_reason, created_at`;

const REFRESH_COLUMNS = `id, session_id, parent_id, generation, issued_at, first_presented_at,
  superseded_at, superseded_reason`;

function toSession(r: Record<string, unknown>): SessionRow {
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    delivery: r["delivery"] as SessionRow["delivery"],
    clientKind: r["client_kind"] as ClientKind,
    deviceLabel: r["device_label"] as string,
    authMethod: r["auth_method"] as SessionRow["authMethod"],
    accessExpiresAt: r["access_expires_at"] as Date,
    currentRefreshId: r["current_refresh_id"] as string,
    idleExpiresAt: r["idle_expires_at"] as Date,
    confirmedAt: r["confirmed_at"] as Date | null,
    lastUsedAt: r["last_used_at"] as Date,
    revokedAt: r["revoked_at"] as Date | null,
    revokeReason: r["revoke_reason"] as string | null,
    createdAt: r["created_at"] as Date,
  };
}

function toRefresh(r: Record<string, unknown>): RefreshRow {
  return {
    id: r["id"] as string,
    sessionId: r["session_id"] as string,
    parentId: r["parent_id"] as string | null,
    generation: r["generation"] as number,
    issuedAt: r["issued_at"] as Date,
    firstPresentedAt: r["first_presented_at"] as Date | null,
    supersededAt: r["superseded_at"] as Date | null,
    supersededReason: r["superseded_reason"] as RefreshRow["supersededReason"],
  };
}

export async function insertSession(
  h: DbHandle,
  s: Omit<SessionRow, "revokedAt" | "revokeReason" | "createdAt" | "confirmedAt"> & {
    accessTokenHash: Buffer;
    confirmedAt: Date;
  },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO sessions (id, user_id, delivery, client_kind, device_label, auth_method,
       access_token_hash, access_expires_at, current_refresh_id, idle_expires_at, confirmed_at,
       last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      s.id,
      s.userId,
      s.delivery,
      s.clientKind,
      s.deviceLabel,
      s.authMethod,
      s.accessTokenHash,
      s.accessExpiresAt,
      s.currentRefreshId,
      s.idleExpiresAt,
      s.confirmedAt,
      s.lastUsedAt,
    ],
  );
}

export async function insertRefresh(
  h: DbHandle,
  r: {
    id: string;
    sessionId: string;
    parentId: string | null;
    generation: number;
    tokenHash: Buffer;
    issuedAt: Date;
  },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO session_refresh_tokens (id, session_id, parent_id, token_hash, generation, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [r.id, r.sessionId, r.parentId, r.tokenHash, r.generation, r.issuedAt],
  );
}

export type AuthSessionRow = SessionRow & {
  user: { status: string; deletionRequestedBy: string | null; isProductOwner: boolean };
};

/** The session of an access-token hash, with the user facts the auth hook checks. */
export async function findAuthByAccessHash(
  h: DbHandle,
  hash: Buffer,
): Promise<AuthSessionRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${SESSION_COLUMNS.replace(/\b([a-z_]+)\b/g, "s.$1")},
            u.status AS user_status, u.deletion_requested_by AS user_deletion_requested_by,
            u.is_product_owner AS user_is_owner
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.access_token_hash = $1`,
    [hash],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    ...toSession(r),
    user: {
      status: r["user_status"] as string,
      deletionRequestedBy: r["user_deletion_requested_by"] as string | null,
      isProductOwner: r["user_is_owner"] as boolean,
    },
  };
}

/**
 * Locks the session row only: reads the token's session without a lock, locks the session, then
 * re-reads just the presented token. Nothing selects a session's family as a whole.
 */
export async function findRefreshByHashForUpdate(
  h: DbHandle,
  hash: Buffer,
): Promise<{ token: RefreshRow; session: SessionRow } | null> {
  const first = await h.executeSql(
    "SELECT id, session_id FROM session_refresh_tokens WHERE token_hash = $1",
    [hash],
  );
  const found = first.rows[0];
  if (found === undefined) return null;
  const locked = await h.executeSql(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1 FOR UPDATE`,
    [found["session_id"]],
  );
  if (locked.rows[0] === undefined) return null;
  const token = await h.executeSql(
    `SELECT ${REFRESH_COLUMNS} FROM session_refresh_tokens WHERE id = $1`,
    [found["id"]],
  );
  if (token.rows[0] === undefined) return null;
  return { token: toRefresh(token.rows[0]), session: toSession(locked.rows[0]) };
}

export async function findRefreshById(h: DbHandle, id: string): Promise<RefreshRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${REFRESH_COLUMNS} FROM session_refresh_tokens WHERE id = $1`,
    [id],
  );
  return rows[0] === undefined ? null : toRefresh(rows[0]);
}

export async function markRefresh(
  h: DbHandle,
  id: string,
  patch: {
    firstPresentedAt?: Date;
    supersededAt?: Date;
    supersededReason?: "rotated" | "discarded";
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${String(values.length)}`);
  };
  if (patch.firstPresentedAt !== undefined) add("first_presented_at", patch.firstPresentedAt);
  if (patch.supersededAt !== undefined) add("superseded_at", patch.supersededAt);
  if (patch.supersededReason !== undefined) add("superseded_reason", patch.supersededReason);
  if (sets.length === 0) return;
  await h.executeSql(
    `UPDATE session_refresh_tokens SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
    values,
  );
}

/** Replaces the access token (the old one stops working) and moves the current refresh token. */
export async function rotate(
  h: DbHandle,
  sessionId: string,
  s: {
    accessTokenHash: Buffer;
    accessExpiresAt: Date;
    currentRefreshId: string;
    idleExpiresAt: Date;
    lastUsedAt: Date;
  },
): Promise<void> {
  await h.executeSql(
    `UPDATE sessions SET access_token_hash = $2, access_expires_at = $3, current_refresh_id = $4,
       idle_expires_at = $5, last_used_at = $6, updated_at = now()
     WHERE id = $1`,
    [
      sessionId,
      s.accessTokenHash,
      s.accessExpiresAt,
      s.currentRefreshId,
      s.idleExpiresAt,
      s.lastUsedAt,
    ],
  );
}

export async function findById(
  h: DbHandle,
  id: string,
  opts?: { lock?: boolean },
): Promise<SessionRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1${opts?.lock === true ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] === undefined ? null : toSession(rows[0]);
}

/** Not revoked, idle expiry not passed; `last_used_at` descending. */
export async function listLive(h: DbHandle, userId: string, now: Date): Promise<SessionRow[]> {
  const { rows } = await h.executeSql(
    `SELECT ${SESSION_COLUMNS} FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2
      ORDER BY last_used_at DESC, id DESC`,
    [userId, now],
  );
  return rows.map(toSession);
}

/** Only if not yet revoked. */
export async function revoke(
  h: DbHandle,
  sessionId: string,
  reason: string,
  at: Date,
): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `UPDATE sessions SET revoked_at = $3, revoke_reason = $2, updated_at = now()
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason, at],
  );
  return rowCount > 0;
}

export async function revokeAllForUser(
  h: DbHandle,
  userId: string,
  reason: string,
  at: Date,
  exceptSessionId?: string,
): Promise<number> {
  const { rowCount } = await h.executeSql(
    `UPDATE sessions SET revoked_at = $3, revoke_reason = $2, updated_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [userId, reason, at, exceptSessionId ?? null],
  );
  return rowCount;
}

export async function setConfirmed(h: DbHandle, sessionId: string, at: Date): Promise<void> {
  await h.executeSql("UPDATE sessions SET confirmed_at = $2, updated_at = now() WHERE id = $1", [
    sessionId,
    at,
  ]);
}

/** Deletes sessions revoked or idle-expired before `before`; their tokens cascade. */
export async function purgeEnded(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions WHERE revoked_at < $1 OR idle_expires_at < $1 LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}

/**
 * Deletes superseded tokens issued before `before`, never a session's current token or its
 * parent. The parent exclusion is load-bearing: R2 keeps issuing from the same old parent, and
 * deleting it would turn R2 into REFRESH_INVALID. No lock is needed: no concurrent rotation can
 * make a prune-eligible token the parent.
 */
export async function pruneRefreshTokens(
  h: DbHandle,
  before: Date,
  limit: number,
): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM session_refresh_tokens WHERE id IN (
       SELECT t.id FROM session_refresh_tokens t
         JOIN sessions s ON s.id = t.session_id
        WHERE t.superseded_at IS NOT NULL AND t.issued_at < $1
          AND t.id <> s.current_refresh_id
          AND NOT EXISTS (
            SELECT 1 FROM session_refresh_tokens c WHERE c.id = s.current_refresh_id AND c.parent_id = t.id)
        LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
