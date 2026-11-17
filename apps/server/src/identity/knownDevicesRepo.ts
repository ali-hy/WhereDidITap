// F-18: known devices (LD-1).
import type { DbHandle } from "../platform/db/types.js";

export async function insert(
  h: DbHandle,
  d: { id: string; userId: string; tokenHash: Buffer; lastUsedAt: Date; expiresAt: Date },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO known_devices (id, user_id, token_hash, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [d.id, d.userId, d.tokenHash, d.lastUsedAt, d.expiresAt],
  );
}

export async function findValid(
  h: DbHandle,
  hash: Buffer,
  now: Date,
): Promise<{ id: string; userId: string } | null> {
  const { rows } = await h.executeSql(
    "SELECT id, user_id FROM known_devices WHERE token_hash = $1 AND expires_at > $2",
    [hash, now],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row["id"] as string, userId: row["user_id"] as string };
}

export async function touch(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    "UPDATE known_devices SET last_used_at = $2, updated_at = now() WHERE id = $1",
    [id, at],
  );
}

/** Deletes all but the `keep` most recently used. */
export async function trimForUser(h: DbHandle, userId: string, keep: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM known_devices WHERE id IN (
       SELECT id FROM known_devices WHERE user_id = $1
        ORDER BY last_used_at DESC, id DESC OFFSET $2)`,
    [userId, keep],
  );
  return rowCount;
}

export async function purgeExpired(h: DbHandle, now: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM known_devices WHERE id IN (
       SELECT id FROM known_devices WHERE expires_at <= $1 LIMIT $2)`,
    [now, limit],
  );
  return rowCount;
}
