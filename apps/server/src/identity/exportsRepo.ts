// F-17: data exports.
import type { DbHandle } from "../platform/db/types.js";

export interface ExportRow {
  id: string;
  userId: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  objectKey: string | null;
  byteSize: number | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  failureKey: "build_failed" | "too_large" | "erased" | null;
}

const COLUMNS = `id, user_id, status, object_key, byte_size, requested_at, started_at, completed_at,
  expires_at, failure_key`;

function toRow(r: Record<string, unknown>): ExportRow {
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    status: r["status"] as ExportRow["status"],
    objectKey: r["object_key"] as string | null,
    byteSize: r["byte_size"] as number | null,
    requestedAt: r["requested_at"] as Date,
    startedAt: r["started_at"] as Date | null,
    completedAt: r["completed_at"] as Date | null,
    expiresAt: r["expires_at"] as Date | null,
    failureKey: r["failure_key"] as ExportRow["failureKey"],
  };
}

export async function insertQueued(
  h: DbHandle,
  e: { id: string; userId: string; requestedAt: Date },
): Promise<void> {
  await h.executeSql(
    "INSERT INTO data_exports (id, user_id, status, requested_at) VALUES ($1, $2, 'queued', $3)",
    [e.id, e.userId, e.requestedAt],
  );
}

export async function findById(
  h: DbHandle,
  id: string,
  opts?: { lock?: boolean },
): Promise<ExportRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM data_exports WHERE id = $1${opts?.lock === true ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function listRecent(h: DbHandle, userId: string, limit: number): Promise<ExportRow[]> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM data_exports WHERE user_id = $1
      ORDER BY requested_at DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toRow);
}

export async function countSince(h: DbHandle, userId: string, since: Date): Promise<number> {
  const { rows } = await h.executeSql(
    "SELECT count(*)::int AS n FROM data_exports WHERE user_id = $1 AND requested_at >= $2",
    [userId, since],
  );
  return rows[0]?.["n"] as number;
}

/** Only from `queued`. */
export async function markRunning(h: DbHandle, id: string, at: Date): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `UPDATE data_exports SET status = 'running', started_at = $2, updated_at = now()
      WHERE id = $1 AND status = 'queued'`,
    [id, at],
  );
  return rowCount > 0;
}

export async function markReady(
  h: DbHandle,
  id: string,
  r: { objectKey: string; byteSize: number; completedAt: Date; expiresAt: Date },
): Promise<void> {
  await h.executeSql(
    `UPDATE data_exports SET status = 'ready', object_key = $2, byte_size = $3, completed_at = $4,
       expires_at = $5, updated_at = now() WHERE id = $1`,
    [id, r.objectKey, r.byteSize, r.completedAt, r.expiresAt],
  );
}

export async function markFailed(
  h: DbHandle,
  id: string,
  failureKey: string,
  at: Date,
): Promise<void> {
  await h.executeSql(
    `UPDATE data_exports SET status = 'failed', failure_key = $2, completed_at = $3, updated_at = now()
      WHERE id = $1`,
    [id, failureKey, at],
  );
}

/** Fails the user's queued or running export. */
export async function failActiveForUser(
  h: DbHandle,
  userId: string,
  failureKey: string,
  at: Date,
): Promise<number> {
  const { rowCount } = await h.executeSql(
    `UPDATE data_exports SET status = 'failed', failure_key = $2, completed_at = $3, updated_at = now()
      WHERE user_id = $1 AND status IN ('queued', 'running')`,
    [userId, failureKey, at],
  );
  return rowCount;
}

/** Ready exports whose expiry has passed become `expired`. */
export async function expireDue(h: DbHandle, now: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `UPDATE data_exports SET status = 'expired', updated_at = now() WHERE id IN (
       SELECT id FROM data_exports WHERE status = 'ready' AND expires_at <= $1 LIMIT $2)`,
    [now, limit],
  );
  return rowCount;
}

/** Expired and failed rows older than `before`. */
export async function purge(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM data_exports WHERE id IN (
       SELECT id FROM data_exports
        WHERE status IN ('expired', 'failed') AND COALESCE(expires_at, completed_at, requested_at) < $1
        LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
