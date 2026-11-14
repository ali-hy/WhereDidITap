// F-15: the identity_settings singleton, created on first use.
import type { DbHandle } from "../platform/db/types.js";
import { DEFAULT_USER_CAP } from "./constants.js";

async function ensureRow(h: DbHandle): Promise<void> {
  await h.executeSql(
    "INSERT INTO identity_settings (id, user_cap) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
    [DEFAULT_USER_CAP],
  );
}

async function read(h: DbHandle, lock: boolean): Promise<{ userCap: number }> {
  await ensureRow(h);
  const { rows } = await h.executeSql(
    `SELECT user_cap FROM identity_settings WHERE id = 1${lock ? " FOR UPDATE" : ""}`,
  );
  return { userCap: rows[0]?.["user_cap"] as number };
}

/** Locks the row. */
export const getForUpdate = (h: DbHandle) => read(h, true);

export const get = (h: DbHandle) => read(h, false);

/** An upsert: it works on a database where nothing has created the row yet. */
export async function setUserCap(h: DbHandle, cap: number): Promise<void> {
  await h.executeSql(
    `INSERT INTO identity_settings (id, user_cap) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET user_cap = EXCLUDED.user_cap, updated_at = now()`,
    [cap],
  );
}
