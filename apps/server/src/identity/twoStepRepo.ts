// F-10: two-step credentials and recovery codes.
import type { DbHandle } from "../platform/db/types.js";

export interface TwoStepRow {
  userId: string;
  state: "pending" | "enabled";
  secretEnvelope: Buffer | null;
  pendingSecretEnvelope: Buffer | null;
  pendingExpiresAt: Date | null;
  lastUsedStep: number | null;
  enabledAt: Date | null;
  codesAcknowledged: boolean;
}

export async function get(
  h: DbHandle,
  userId: string,
  opts?: { lock?: boolean },
): Promise<TwoStepRow | null> {
  const { rows } = await h.executeSql(
    `SELECT user_id, state, secret_envelope, pending_secret_envelope, pending_expires_at,
            last_used_step, enabled_at, codes_acknowledged
       FROM two_step_credentials WHERE user_id = $1${opts?.lock === true ? " FOR UPDATE" : ""}`,
    [userId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    userId: r["user_id"] as string,
    state: r["state"] as TwoStepRow["state"],
    secretEnvelope: r["secret_envelope"] as Buffer | null,
    pendingSecretEnvelope: r["pending_secret_envelope"] as Buffer | null,
    pendingExpiresAt: r["pending_expires_at"] as Date | null,
    lastUsedStep: r["last_used_step"] as number | null,
    enabledAt: r["enabled_at"] as Date | null,
    codesAcknowledged: r["codes_acknowledged"] as boolean,
  };
}

/** A new pending row, or, when two-step is enabled, only the pending columns. */
export async function upsertPending(
  h: DbHandle,
  userId: string,
  envelope: Buffer,
  expiresAt: Date,
): Promise<void> {
  await h.executeSql(
    `INSERT INTO two_step_credentials (user_id, state, pending_secret_envelope, pending_expires_at)
     VALUES ($1, 'pending', $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET pending_secret_envelope = EXCLUDED.pending_secret_envelope,
       pending_expires_at = EXCLUDED.pending_expires_at, updated_at = now()`,
    [userId, envelope, expiresAt],
  );
}

/** Pending row: the pending secret becomes the secret, and the state `enabled`. */
export async function enable(h: DbHandle, userId: string, at: Date): Promise<void> {
  await h.executeSql(
    `UPDATE two_step_credentials SET secret_envelope = pending_secret_envelope,
       pending_secret_envelope = NULL, pending_expires_at = NULL, state = 'enabled', enabled_at = $2,
       codes_acknowledged = false, updated_at = now()
     WHERE user_id = $1`,
    [userId, at],
  );
}

/** Enabled row: the pending secret replaces the secret and the used step resets. */
export async function swapPending(h: DbHandle, userId: string): Promise<void> {
  await h.executeSql(
    `UPDATE two_step_credentials SET secret_envelope = pending_secret_envelope,
       pending_secret_envelope = NULL, pending_expires_at = NULL, last_used_step = NULL,
       updated_at = now()
     WHERE user_id = $1`,
    [userId],
  );
}

export async function clearPending(h: DbHandle, userId: string): Promise<void> {
  await h.executeSql(
    `UPDATE two_step_credentials SET pending_secret_envelope = NULL, pending_expires_at = NULL,
       updated_at = now() WHERE user_id = $1`,
    [userId],
  );
}

export async function setLastUsedStep(h: DbHandle, userId: string, step: number): Promise<void> {
  await h.executeSql(
    "UPDATE two_step_credentials SET last_used_step = $2, updated_at = now() WHERE user_id = $1",
    [userId, step],
  );
}

export async function setCodesAcknowledged(h: DbHandle, userId: string, v: boolean): Promise<void> {
  await h.executeSql(
    "UPDATE two_step_credentials SET codes_acknowledged = $2, updated_at = now() WHERE user_id = $1",
    [userId, v],
  );
}

/** Also deletes the user's recovery codes. */
export async function remove(h: DbHandle, userId: string): Promise<void> {
  await h.executeSql("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
  await h.executeSql("DELETE FROM two_step_credentials WHERE user_id = $1", [userId]);
}

/** Deletes every code, then inserts the new ones. */
export async function replaceRecoveryCodes(
  h: DbHandle,
  userId: string,
  codes: readonly { id: string; keyId: string; hmac: Buffer }[],
): Promise<void> {
  await h.executeSql("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
  for (const code of codes) {
    await h.executeSql(
      "INSERT INTO recovery_codes (id, user_id, key_id, code_hmac) VALUES ($1, $2, $3, $4)",
      [code.id, userId, code.keyId, code.hmac],
    );
  }
}

export async function findUnusedCode(
  h: DbHandle,
  userId: string,
  candidates: readonly { keyId: string; hmac: Buffer }[],
  opts: { lock: boolean },
): Promise<{ id: string } | null> {
  if (candidates.length === 0) return null;
  const lock = opts.lock ? " FOR UPDATE" : "";
  const { rows } = await h.executeSql(
    `SELECT id FROM recovery_codes
      WHERE user_id = $1 AND used_at IS NULL
        AND (key_id, code_hmac) IN (SELECT * FROM unnest($2::text[], $3::bytea[]))
      LIMIT 1${lock}`,
    [userId, candidates.map((c) => c.keyId), candidates.map((c) => c.hmac)],
  );
  return rows[0] === undefined ? null : { id: rows[0]["id"] as string };
}

export async function markCodeUsed(h: DbHandle, codeId: string, at: Date): Promise<void> {
  await h.executeSql("UPDATE recovery_codes SET used_at = $2, updated_at = now() WHERE id = $1", [
    codeId,
    at,
  ]);
}

export async function countUnusedCodes(h: DbHandle, userId: string): Promise<number> {
  const { rows } = await h.executeSql(
    "SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  return rows[0]?.["n"] as number;
}

/**
 * Deletes pending rows whose setup expired and clears the pending columns of enabled rows whose
 * replacement setup expired. Returns the rows touched.
 */
export async function purgeExpiredPending(h: DbHandle, now: Date, limit: number): Promise<number> {
  const deleted = await h.executeSql(
    `DELETE FROM two_step_credentials WHERE user_id IN (
       SELECT user_id FROM two_step_credentials
        WHERE state = 'pending' AND pending_expires_at < $1 LIMIT $2)`,
    [now, limit],
  );
  const cleared = await h.executeSql(
    `UPDATE two_step_credentials SET pending_secret_envelope = NULL, pending_expires_at = NULL,
       updated_at = now()
      WHERE user_id IN (
        SELECT user_id FROM two_step_credentials
         WHERE state = 'enabled' AND pending_expires_at < $1 LIMIT $2)`,
    [now, limit],
  );
  return deleted.rowCount + cleared.rowCount;
}
