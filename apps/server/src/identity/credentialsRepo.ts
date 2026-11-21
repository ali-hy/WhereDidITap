// F-9: password and Google credentials.
import type { DbHandle } from "../platform/db/types.js";

export async function getPasswordHash(
  h: DbHandle,
  userId: string,
): Promise<{ hash: string; updatedAt: Date } | null> {
  const { rows } = await h.executeSql(
    "SELECT password_hash, updated_at FROM password_credentials WHERE user_id = $1",
    [userId],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { hash: row["password_hash"] as string, updatedAt: row["updated_at"] as Date };
}

export async function upsertPassword(h: DbHandle, userId: string, hash: string): Promise<void> {
  await h.executeSql(
    `INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [userId, hash],
  );
}

export interface GoogleIdentity {
  id: string;
  userId: string;
  googleSub: string;
  emailAtLink: string;
}

function toGoogle(r: Record<string, unknown>): GoogleIdentity {
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    googleSub: r["google_sub"] as string,
    emailAtLink: r["email_at_link"] as string,
  };
}

export async function findGoogleBySub(h: DbHandle, sub: string): Promise<GoogleIdentity | null> {
  const { rows } = await h.executeSql(
    "SELECT id, user_id, google_sub, email_at_link FROM google_identities WHERE google_sub = $1",
    [sub],
  );
  return rows[0] === undefined ? null : toGoogle(rows[0]);
}

export async function findGoogleByUser(
  h: DbHandle,
  userId: string,
): Promise<Omit<GoogleIdentity, "userId"> | null> {
  const { rows } = await h.executeSql(
    "SELECT id, user_id, google_sub, email_at_link FROM google_identities WHERE user_id = $1",
    [userId],
  );
  if (rows[0] === undefined) return null;
  const { id, googleSub, emailAtLink } = toGoogle(rows[0]);
  return { id, googleSub, emailAtLink };
}

export async function insertGoogle(
  h: DbHandle,
  row: { id: string; userId: string; googleSub: string; emailAtLink: string; linkedAt: Date },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO google_identities (id, user_id, google_sub, email_at_link, linked_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.userId, row.googleSub, row.emailAtLink, row.linkedAt],
  );
}

export async function deleteGoogleByUser(h: DbHandle, userId: string): Promise<boolean> {
  const { rowCount } = await h.executeSql("DELETE FROM google_identities WHERE user_id = $1", [
    userId,
  ]);
  return rowCount > 0;
}

export async function touchGoogle(h: DbHandle, id: string, at: Date): Promise<void> {
  await h.executeSql(
    "UPDATE google_identities SET last_used_at = $2, updated_at = now() WHERE id = $1",
    [id, at],
  );
}
