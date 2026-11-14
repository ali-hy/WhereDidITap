// F-15: banned email addresses.
import type { DbHandle } from "../platform/db/types.js";

export async function isBanned(h: DbHandle, email: string): Promise<boolean> {
  const { rows } = await h.executeSql(
    "SELECT EXISTS (SELECT 1 FROM email_bans WHERE email = $1) AS banned",
    [email],
  );
  return rows[0]?.["banned"] === true;
}

/** False when the address was already banned. */
export async function insertBan(
  h: DbHandle,
  b: { email: string; bannedAt: Date; bannedByUserId: string | null },
): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `INSERT INTO email_bans (email, banned_at, banned_by_user_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [b.email, b.bannedAt, b.bannedByUserId],
  );
  return rowCount > 0;
}

export async function deleteBan(h: DbHandle, email: string): Promise<boolean> {
  const { rowCount } = await h.executeSql("DELETE FROM email_bans WHERE email = $1", [email]);
  return rowCount > 0;
}
