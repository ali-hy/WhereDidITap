// F-101: idempotency records.
import type { DbHandle } from "../db/types.js";

export async function insertIfAbsent(
  h: DbHandle,
  r: { userId: string; key: string; procedure: string; requestHash: Buffer; expiresAt: Date },
): Promise<boolean> {
  const { rows } = await h.executeSql(
    `INSERT INTO idempotency_records (user_id, idempotency_key, procedure, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING 1 AS inserted`,
    [r.userId, r.key, r.procedure, r.requestHash, r.expiresAt],
  );
  return rows.length === 1;
}

export async function find(
  h: DbHandle,
  userId: string,
  key: string,
): Promise<{
  procedure: string;
  requestHash: Buffer;
  responseStatus: number | null;
  result: { id: string; createdAt: string } | null;
} | null> {
  const { rows } = await h.executeSql(
    `SELECT procedure, request_hash, response_status, result
     FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key],
  );
  const row = rows[0];
  if (row === undefined) return null;
  // smallint: pg returns a number (null until complete).
  const status: unknown = row["response_status"];
  return {
    procedure: String(row["procedure"]),
    requestHash: row["request_hash"] as Buffer,
    responseStatus: typeof status === "number" ? status : null,
    result: (row["result"] as { id: string; createdAt: string } | null) ?? null,
  };
}

export async function complete(
  h: DbHandle,
  userId: string,
  key: string,
  status: number,
  result: { id: string; createdAt: string },
): Promise<void> {
  await h.executeSql(
    `UPDATE idempotency_records
     SET response_status = $3, result = $4, updated_at = now()
     WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key, status, JSON.stringify(result)],
  );
}
