// F-14: password resets.
import type { DbHandle } from "../platform/db/types.js";

export interface ResetRow {
  id: string;
  userId: string;
  expiresAt: Date;
  failedCodes: number;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
}

const COLUMNS = "id, user_id, expires_at, failed_codes, used_at, invalidated_at, created_at";

function toRow(r: Record<string, unknown>): ResetRow {
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    expiresAt: r["expires_at"] as Date,
    failedCodes: r["failed_codes"] as number,
    usedAt: r["used_at"] as Date | null,
    invalidatedAt: r["invalidated_at"] as Date | null,
    createdAt: r["created_at"] as Date,
  };
}

export async function insert(
  h: DbHandle,
  r: { id: string; userId: string; expiresAt: Date },
): Promise<void> {
  await h.executeSql("INSERT INTO password_resets (id, user_id, expires_at) VALUES ($1, $2, $3)", [
    r.id,
    r.userId,
    r.expiresAt,
  ]);
}

export async function findById(h: DbHandle, id: string): Promise<ResetRow | null> {
  const { rows } = await h.executeSql(`SELECT ${COLUMNS} FROM password_resets WHERE id = $1`, [id]);
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function findByTokenHashForUpdate(
  h: DbHandle,
  hash: Buffer,
): Promise<ResetRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM password_resets WHERE token_hash = $1 FOR UPDATE`,
    [hash],
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function setToken(h: DbHandle, id: string, hash: Buffer): Promise<void> {
  await h.executeSql(
    "UPDATE password_resets SET token_hash = $2, updated_at = now() WHERE id = $1",
    [id, hash],
  );
}

/** Unused, not invalidated, unexpired. */
export async function countOutstanding(h: DbHandle, userId: string, now: Date): Promise<number> {
  const { rows } = await h.executeSql(
    `SELECT count(*)::int AS n FROM password_resets
      WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > $2`,
    [userId, now],
  );
  return rows[0]?.["n"] as number;
}

export async function incrementFailedCodes(h: DbHandle, id: string): Promise<number> {
  const { rows } = await h.executeSql(
    "UPDATE password_resets SET failed_codes = failed_codes + 1, updated_at = now() WHERE id = $1 RETURNING failed_codes",
    [id],
  );
  return rows[0]?.["failed_codes"] as number;
}

export async function invalidate(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    "UPDATE password_resets SET invalidated_at = $2, updated_at = now() WHERE id = $1",
    [id, at],
  );
}

export async function markUsed(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql("UPDATE password_resets SET used_at = $2, updated_at = now() WHERE id = $1", [
    id,
    at,
  ]);
}

/** Invalidates the user's other unused resets. */
export async function invalidateOthers(
  h: DbHandle,
  userId: string,
  exceptId: string | null,
  at: Date,
): Promise<number> {
  const { rowCount } = await h.executeSql(
    `UPDATE password_resets SET invalidated_at = $3, updated_at = now()
      WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptId, at],
  );
  return rowCount;
}

/** Resets that ended (used, invalidated or expired) before `before`. */
export async function purge(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM password_resets WHERE id IN (
       SELECT id FROM password_resets
        WHERE LEAST(COALESCE(used_at, expires_at), COALESCE(invalidated_at, expires_at), expires_at) < $1
        LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
