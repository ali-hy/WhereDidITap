// F-13: invitations.
import type { DbHandle } from "../platform/db/types.js";

export interface InvitationRow {
  id: string;
  email: string;
  inviterUserId: string | null;
  origin: "direct" | "account_share" | "bootstrap";
  status: "pending" | "accepted" | "revoked" | "expired";
  tokenIssuedAt: Date | null;
  expiresAt: Date;
  sendCount: number;
  lastSentAt: Date | null;
  sendFailedAt: Date | null;
  acceptedUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  endedAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, email, inviter_user_id, origin, status, token_issued_at, expires_at, send_count,
  last_sent_at, send_failed_at, accepted_user_id, accepted_at, revoked_at, revoked_by_user_id,
  ended_at, created_at`;

function toRow(r: Record<string, unknown>): InvitationRow {
  return {
    id: r["id"] as string,
    email: r["email"] as string,
    inviterUserId: r["inviter_user_id"] as string | null,
    origin: r["origin"] as InvitationRow["origin"],
    status: r["status"] as InvitationRow["status"],
    tokenIssuedAt: r["token_issued_at"] as Date | null,
    expiresAt: r["expires_at"] as Date,
    sendCount: r["send_count"] as number,
    lastSentAt: r["last_sent_at"] as Date | null,
    sendFailedAt: r["send_failed_at"] as Date | null,
    acceptedUserId: r["accepted_user_id"] as string | null,
    acceptedAt: r["accepted_at"] as Date | null,
    revokedAt: r["revoked_at"] as Date | null,
    revokedByUserId: r["revoked_by_user_id"] as string | null,
    endedAt: r["ended_at"] as Date | null,
    createdAt: r["created_at"] as Date,
  };
}

const lock = (opts?: { lock?: boolean }): string => (opts?.lock === true ? " FOR UPDATE" : "");

async function one(
  h: DbHandle,
  where: string,
  values: unknown[],
  opts?: { lock?: boolean },
): Promise<InvitationRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM invitations WHERE ${where}${lock(opts)}`,
    values,
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function insert(
  h: DbHandle,
  r: Pick<InvitationRow, "id" | "email" | "inviterUserId" | "origin" | "expiresAt"> & {
    tokenHash?: Buffer | null;
    tokenIssuedAt?: Date | null;
  },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO invitations (id, email, inviter_user_id, origin, expires_at, token_hash, token_issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      r.id,
      r.email,
      r.inviterUserId,
      r.origin,
      r.expiresAt,
      r.tokenHash ?? null,
      r.tokenIssuedAt ?? null,
    ],
  );
}

export const findById = (h: DbHandle, id: string, opts?: { lock?: boolean }) =>
  one(h, "id = $1", [id], opts);

export const findByTokenHash = (h: DbHandle, hash: Buffer, opts?: { lock?: boolean }) =>
  one(h, "token_hash = $1", [hash], opts);

export const findPendingByEmail = (h: DbHandle, email: string, opts?: { lock?: boolean }) =>
  one(h, "email = $1 AND status = 'pending'", [email], opts);

export const findPendingBootstrap = (h: DbHandle, opts?: { lock?: boolean }) =>
  one(h, "origin = 'bootstrap' AND status = 'pending'", [], opts);

/** Pending and due → expired. */
export async function expireIfDue(h: DbHandle, id: string, now: Date): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `UPDATE invitations SET status = 'expired', ended_at = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending' AND expires_at <= $2`,
    [id, now],
  );
  return rowCount > 0;
}

export async function expireDueForEmail(h: DbHandle, email: string, now: Date): Promise<string[]> {
  const { rows } = await h.executeSql(
    `UPDATE invitations SET status = 'expired', ended_at = $2, updated_at = now()
      WHERE email = $1 AND status = 'pending' AND expires_at <= $2 RETURNING id`,
    [email, now],
  );
  return rows.map((r) => r["id"] as string);
}

export async function expireAllDue(h: DbHandle, now: Date, limit: number): Promise<string[]> {
  const { rows } = await h.executeSql(
    `UPDATE invitations SET status = 'expired', ended_at = $1, updated_at = now()
      WHERE id IN (SELECT id FROM invitations WHERE status = 'pending' AND expires_at <= $1 LIMIT $2)
      RETURNING id`,
    [now, limit],
  );
  return rows.map((r) => r["id"] as string);
}

export async function setToken(
  h: DbHandle,
  id: string,
  hash: Buffer,
  issuedAt: Date,
  newExpiresAt: Date | null,
): Promise<void> {
  await h.executeSql(
    `UPDATE invitations SET token_hash = $2, token_issued_at = $3,
       expires_at = COALESCE($4, expires_at), updated_at = now() WHERE id = $1`,
    [id, hash, issuedAt, newExpiresAt],
  );
}

export async function markSent(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    `UPDATE invitations SET send_count = send_count + 1, last_sent_at = $2, send_failed_at = NULL,
       updated_at = now() WHERE id = $1`,
    [id, at],
  );
}

export async function markSendFailed(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    "UPDATE invitations SET send_failed_at = $2, updated_at = now() WHERE id = $1",
    [id, at],
  );
}

export async function markAccepted(
  h: DbHandle,
  id: string,
  userId: string,
  at: Date,
): Promise<void> {
  await h.executeSql(
    `UPDATE invitations SET status = 'accepted', accepted_user_id = $2, accepted_at = $3,
       ended_at = $3, updated_at = now() WHERE id = $1`,
    [id, userId, at],
  );
}

/** Only a pending invitation. */
export async function revoke(
  h: DbHandle,
  id: string,
  byUserId: string | null,
  at: Date,
): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = $3, revoked_by_user_id = $2,
       ended_at = $3, updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [id, byUserId, at],
  );
  return rowCount > 0;
}

export async function revokePendingByInviter(
  h: DbHandle,
  inviterId: string,
  at: Date,
): Promise<string[]> {
  const { rows } = await h.executeSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = $2, revoked_by_user_id = NULL,
       ended_at = $2, updated_at = now()
      WHERE inviter_user_id = $1 AND status = 'pending' RETURNING id`,
    [inviterId, at],
  );
  return rows.map((r) => r["id"] as string);
}

export async function revokePendingForEmail(
  h: DbHandle,
  email: string,
  byUserId: string | null,
  at: Date,
): Promise<string[]> {
  const { rows } = await h.executeSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = $3, revoked_by_user_id = $2,
       ended_at = $3, updated_at = now()
      WHERE email = $1 AND status = 'pending' RETURNING id`,
    [email, byUserId, at],
  );
  return rows.map((r) => r["id"] as string);
}

/** Pending and unexpired, plus accepted. */
export async function countForAllowance(
  h: DbHandle,
  inviterId: string,
  now: Date,
): Promise<number> {
  const { rows } = await h.executeSql(
    `SELECT count(*)::int AS n FROM invitations
      WHERE inviter_user_id = $1 AND ((status = 'pending' AND expires_at > $2) OR status = 'accepted')`,
    [inviterId, now],
  );
  return rows[0]?.["n"] as number;
}

export async function countPendingLive(h: DbHandle, now: Date): Promise<number> {
  const { rows } = await h.executeSql(
    "SELECT count(*)::int AS n FROM invitations WHERE status = 'pending' AND expires_at > $1",
    [now],
  );
  return rows[0]?.["n"] as number;
}

/** `created_at desc, id desc`. */
export async function listByInviter(
  h: DbHandle,
  inviterId: string,
  q: { after: { createdAt: Date; id: string } | null; limit: number },
): Promise<InvitationRow[]> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM invitations
      WHERE inviter_user_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $4`,
    [inviterId, q.after?.createdAt ?? null, q.after?.id ?? null, q.limit],
  );
  return rows.map(toRow);
}

export async function listAll(
  h: DbHandle,
  q: {
    after: { createdAt: Date; id: string } | null;
    limit: number;
    status?: InvitationRow["status"];
    inviterUserId?: string;
  },
): Promise<(InvitationRow & { inviterDisplayName: string | null })[]> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS.replace(/\b([a-z_]+)\b/g, "i.$1")}, u.display_name AS inviter_display_name
       FROM invitations i LEFT JOIN users u ON u.id = i.inviter_user_id
      WHERE ($1::timestamptz IS NULL OR (i.created_at, i.id) < ($1::timestamptz, $2::uuid))
        AND ($3::text IS NULL OR i.status = $3)
        AND ($4::uuid IS NULL OR i.inviter_user_id = $4::uuid)
      ORDER BY i.created_at DESC, i.id DESC LIMIT $5`,
    [
      q.after?.createdAt ?? null,
      q.after?.id ?? null,
      q.status ?? null,
      q.inviterUserId ?? null,
      q.limit,
    ],
  );
  return rows.map((r) => ({
    ...toRow(r),
    inviterDisplayName: r["inviter_display_name"] as string | null,
  }));
}

/** Revoked and expired invitations that ended before `before`. */
export async function purgeEnded(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM invitations WHERE id IN (
       SELECT id FROM invitations WHERE status IN ('revoked', 'expired') AND ended_at < $1 LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
