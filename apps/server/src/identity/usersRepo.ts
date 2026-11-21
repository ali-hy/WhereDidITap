// F-8: the users table. Unique violations propagate as the driver error (code 23505).
import type { DbHandle } from "../platform/db/types.js";

export interface UserRow {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string;
  locale: string;
  timeZone: string;
  baseCurrency: string;
  status: "active" | "pending_deletion";
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  deletionRequestedBy: "self" | "owner" | "ban" | null;
  isProductOwner: boolean;
  inviteAllowance: number | null;
  invitedByUserId: string | null;
  lastActiveAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, email, email_verified_at, display_name, locale, time_zone, base_currency, status,
  deletion_requested_at, deletion_scheduled_for, deletion_requested_by, is_product_owner,
  invite_allowance, invited_by_user_id, last_active_at, created_at`;

export function toUserRow(r: Record<string, unknown>): UserRow {
  return {
    id: r["id"] as string,
    email: r["email"] as string,
    emailVerifiedAt: r["email_verified_at"] as Date | null,
    displayName: r["display_name"] as string,
    locale: r["locale"] as string,
    timeZone: r["time_zone"] as string,
    baseCurrency: r["base_currency"] as string,
    status: r["status"] as UserRow["status"],
    deletionRequestedAt: r["deletion_requested_at"] as Date | null,
    deletionScheduledFor: r["deletion_scheduled_for"] as Date | null,
    deletionRequestedBy: r["deletion_requested_by"] as UserRow["deletionRequestedBy"],
    isProductOwner: r["is_product_owner"] as boolean,
    inviteAllowance: r["invite_allowance"] as number | null,
    invitedByUserId: r["invited_by_user_id"] as string | null,
    lastActiveAt: r["last_active_at"] as Date | null,
    createdAt: r["created_at"] as Date,
  };
}

const lockClause = (opts?: { lock?: boolean }): string =>
  opts?.lock === true ? " FOR UPDATE" : "";

export async function insert(
  h: DbHandle,
  row: Omit<UserRow, "createdAt" | "lastActiveAt">,
): Promise<void> {
  await h.executeSql(
    `INSERT INTO users (id, email, email_verified_at, display_name, locale, time_zone, base_currency,
       status, deletion_requested_at, deletion_scheduled_for, deletion_requested_by, is_product_owner,
       invite_allowance, invited_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      row.id,
      row.email,
      row.emailVerifiedAt,
      row.displayName,
      row.locale,
      row.timeZone,
      row.baseCurrency,
      row.status,
      row.deletionRequestedAt,
      row.deletionScheduledFor,
      row.deletionRequestedBy,
      row.isProductOwner,
      row.inviteAllowance,
      row.invitedByUserId,
    ],
  );
}

export async function findById(
  h: DbHandle,
  id: string,
  opts?: { lock?: boolean },
): Promise<UserRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM users WHERE id = $1${lockClause(opts)}`,
    [id],
  );
  return rows[0] === undefined ? null : toUserRow(rows[0]);
}

/** Expects a normalised email. */
export async function findByEmail(
  h: DbHandle,
  email: string,
  opts?: { lock?: boolean },
): Promise<UserRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM users WHERE email = $1${lockClause(opts)}`,
    [email],
  );
  return rows[0] === undefined ? null : toUserRow(rows[0]);
}

const PROFILE_COLUMNS = {
  displayName: "display_name",
  locale: "locale",
  timeZone: "time_zone",
  baseCurrency: "base_currency",
} as const;

export async function updateProfile(
  h: DbHandle,
  id: string,
  patch: Partial<Pick<UserRow, "displayName" | "locale" | "timeZone" | "baseCurrency">>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
    const value = patch[field as keyof typeof PROFILE_COLUMNS];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${String(values.length)}`);
  }
  if (sets.length === 0) return;
  await h.executeSql(
    `UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
    values,
  );
}

/** `null` returns the user to `active` and clears the three fields in one statement. */
export async function setDeletion(
  h: DbHandle,
  id: string,
  d: { requestedAt: Date; scheduledFor: Date; requestedBy: "self" | "owner" | "ban" } | null,
): Promise<void> {
  if (d === null) {
    await h.executeSql(
      `UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_scheduled_for = NULL,
         deletion_requested_by = NULL, updated_at = now() WHERE id = $1`,
      [id],
    );
    return;
  }
  await h.executeSql(
    `UPDATE users SET status = 'pending_deletion', deletion_requested_at = $2,
       deletion_scheduled_for = $3, deletion_requested_by = $4, updated_at = now() WHERE id = $1`,
    [id, d.requestedAt, d.scheduledFor, d.requestedBy],
  );
}

export async function setInviteAllowance(
  h: DbHandle,
  id: string,
  allowance: number | null,
): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    "UPDATE users SET invite_allowance = $2, updated_at = now() WHERE id = $1",
    [id, allowance],
  );
  return rowCount > 0;
}

export async function setOwner(h: DbHandle, id: string): Promise<void> {
  await h.executeSql("UPDATE users SET is_product_owner = true, updated_at = now() WHERE id = $1", [
    id,
  ]);
}

/** Only when `last_active_at` is null or before the hour of `at`. */
export async function touchLastActive(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    `UPDATE users SET last_active_at = $2, updated_at = now()
      WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < date_trunc('hour', $2::timestamptz))`,
    [id, at],
  );
}

export async function countAll(h: DbHandle): Promise<number> {
  const { rows } = await h.executeSql("SELECT count(*)::int AS n FROM users");
  return rows[0]?.["n"] as number;
}

export async function findOwner(h: DbHandle): Promise<UserRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM users WHERE is_product_owner LIMIT 1`,
  );
  return rows[0] === undefined ? null : toUserRow(rows[0]);
}

export async function dueForErasure(h: DbHandle, now: Date, limit: number): Promise<string[]> {
  const { rows } = await h.executeSql(
    `SELECT id FROM users WHERE status = 'pending_deletion' AND deletion_scheduled_for <= $1
      ORDER BY deletion_scheduled_for LIMIT $2`,
    [now, limit],
  );
  return rows.map((r) => r["id"] as string);
}

/** `created_at desc, id desc`. */
export async function listPage(
  h: DbHandle,
  q: {
    after: { createdAt: Date; id: string } | null;
    limit: number;
    status?: "active" | "pending_deletion";
  },
): Promise<UserRow[]> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM users
      WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
        AND ($3::text IS NULL OR status = $3)
      ORDER BY created_at DESC, id DESC LIMIT $4`,
    [q.after?.createdAt ?? null, q.after?.id ?? null, q.status ?? null, q.limit],
  );
  return rows.map(toUserRow);
}

export async function displayNames(
  h: DbHandle,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const { rows } = await h.executeSql(
    "SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])",
    [[...ids]],
  );
  return new Map(rows.map((r) => [r["id"] as string, r["display_name"] as string]));
}

export async function deleteById(h: DbHandle, id: string): Promise<boolean> {
  const { rowCount } = await h.executeSql("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}
