// F-12: short-lived authentication state (two-step challenges, Google flows, sign-up tickets).
import type { DbHandle } from "../platform/db/types.js";
import type { ClientKind } from "../platform/http/context.js";

export type ChallengeIntent = "sign_in" | "sign_up" | "link" | "confirm";

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  iat: number;
}

/** `email` is normalised. */
export interface PendingGoogleLink {
  sub: string;
  email: string;
}

export type ChallengeData =
  | {
      kind: "two_step";
      delivery: "cookie" | "bearer";
      method: "password" | "google";
      pendingLink: PendingGoogleLink | null;
      clientKind: ClientKind;
      deviceLabel: string;
    }
  | {
      kind: "google_web";
      intent: ChallengeIntent;
      appOrigin: string;
      returnTo: string;
      codeVerifier: string;
      nonce: string;
      claims: GoogleClaims | null;
    }
  | { kind: "google_nonce"; intent: ChallengeIntent }
  | { kind: "google_signup"; claims: GoogleClaims };

export type ChallengeKind = ChallengeData["kind"];

export interface ChallengeRow {
  id: string;
  kind: ChallengeKind;
  tokenHash: Buffer;
  secondaryHash: Buffer | null;
  bindingHash: Buffer | null;
  userId: string | null;
  sessionId: string | null;
  invitationId: string | null;
  data: ChallengeData;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, kind, token_hash, secondary_hash, binding_hash, user_id, session_id, invitation_id,
  data, attempts, expires_at, consumed_at, created_at`;

function toRow(r: Record<string, unknown>): ChallengeRow {
  return {
    id: r["id"] as string,
    kind: r["kind"] as ChallengeKind,
    tokenHash: r["token_hash"] as Buffer,
    secondaryHash: r["secondary_hash"] as Buffer | null,
    bindingHash: r["binding_hash"] as Buffer | null,
    userId: r["user_id"] as string | null,
    sessionId: r["session_id"] as string | null,
    invitationId: r["invitation_id"] as string | null,
    data: r["data"] as ChallengeData,
    attempts: r["attempts"] as number,
    expiresAt: r["expires_at"] as Date,
    consumedAt: r["consumed_at"] as Date | null,
    createdAt: r["created_at"] as Date,
  };
}

export async function insert(
  h: DbHandle,
  c: {
    id: string;
    kind: ChallengeKind;
    tokenHash: Buffer;
    bindingHash?: Buffer | null;
    userId?: string | null;
    sessionId?: string | null;
    invitationId?: string | null;
    data: ChallengeData;
    expiresAt: Date;
  },
): Promise<void> {
  await h.executeSql(
    `INSERT INTO auth_challenges (id, kind, token_hash, binding_hash, user_id, session_id,
       invitation_id, data, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      c.id,
      c.kind,
      c.tokenHash,
      c.bindingHash ?? null,
      c.userId ?? null,
      c.sessionId ?? null,
      c.invitationId ?? null,
      JSON.stringify(c.data),
      c.expiresAt,
    ],
  );
}

export async function findByTokenHashForUpdate(
  h: DbHandle,
  kind: ChallengeKind,
  hash: Buffer,
): Promise<ChallengeRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM auth_challenges WHERE kind = $1 AND token_hash = $2 FOR UPDATE`,
    [kind, hash],
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function findBySecondaryHashForUpdate(
  h: DbHandle,
  kind: ChallengeKind,
  hash: Buffer,
): Promise<ChallengeRow | null> {
  const { rows } = await h.executeSql(
    `SELECT ${COLUMNS} FROM auth_challenges WHERE kind = $1 AND secondary_hash = $2 FOR UPDATE`,
    [kind, hash],
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function setCallbackResult(
  h: DbHandle,
  id: string,
  r: { secondaryHash: Buffer; claims: GoogleClaims; expiresAt: Date },
): Promise<void> {
  await h.executeSql(
    `UPDATE auth_challenges SET secondary_hash = $2,
       data = jsonb_set(data, '{claims}', $3::jsonb), expires_at = $4, updated_at = now()
     WHERE id = $1`,
    [id, r.secondaryHash, JSON.stringify(r.claims), r.expiresAt],
  );
}

export async function incrementAttempts(h: DbHandle, id: string): Promise<number> {
  const { rows } = await h.executeSql(
    "UPDATE auth_challenges SET attempts = attempts + 1, updated_at = now() WHERE id = $1 RETURNING attempts",
    [id],
  );
  return rows[0]?.["attempts"] as number;
}

export async function consume(h: DbHandle, id: string, at: Date): Promise<boolean> {
  const { rowCount } = await h.executeSql(
    `UPDATE auth_challenges SET consumed_at = $2, updated_at = now()
      WHERE id = $1 AND consumed_at IS NULL`,
    [id, at],
  );
  return rowCount > 0;
}

/** Rows whose consumption (else expiry) is before `before`. */
export async function purge(h: DbHandle, before: Date, limit: number): Promise<number> {
  const { rowCount } = await h.executeSql(
    `DELETE FROM auth_challenges WHERE id IN (
       SELECT id FROM auth_challenges WHERE COALESCE(consumed_at, expires_at) < $1 LIMIT $2)`,
    [before, limit],
  );
  return rowCount;
}
