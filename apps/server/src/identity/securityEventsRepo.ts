// F-16: security events.
import type { DbHandle } from "../platform/db/types.js";
import type { SecurityEventKind } from "./constants.js";

export async function insert(
  h: DbHandle,
  e: {
    id: string;
    userId: string;
    kind: string;
    sessionId: string | null;
    clientKind: string | null;
  },
): Promise<void> {
  await h.executeSql(
    "INSERT INTO security_events (id, user_id, kind, session_id, client_kind) VALUES ($1, $2, $3, $4, $5)",
    [e.id, e.userId, e.kind, e.sessionId, e.clientKind],
  );
}

export async function findById(
  h: DbHandle,
  id: string,
): Promise<{ id: string; userId: string; kind: SecurityEventKind; createdAt: Date } | null> {
  const { rows } = await h.executeSql(
    "SELECT id, user_id, kind, created_at FROM security_events WHERE id = $1",
    [id],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    kind: r["kind"] as SecurityEventKind,
    createdAt: r["created_at"] as Date,
  };
}

export async function listForUser(
  h: DbHandle,
  userId: string,
  limit: number,
): Promise<{ kind: string; createdAt: Date; clientKind: string | null }[]> {
  const { rows } = await h.executeSql(
    `SELECT kind, created_at, client_kind FROM security_events
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    kind: r["kind"] as string,
    createdAt: r["created_at"] as Date,
    clientKind: r["client_kind"] as string | null,
  }));
}

export async function purge(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM security_events WHERE id IN (
       SELECT id FROM security_events WHERE created_at < $1 LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
