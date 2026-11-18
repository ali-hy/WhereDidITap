// Two-step helpers for identity's S-4 server tests (identity LLD §4.5, §10.1), owned by the
// test-architect.
//
// - apiSecretsOf(api), recoveryRingOf(api): the API's TOTP cipher and recovery-code key ring.
// - twoStepUser(api, opts): a password user with two-step on (TWO_STEP_SECRET) and the known
//   recovery codes; returns the user, the codes and the raw secret.
// - bearer(token): an Authorization header for `call`.
// - securityEvents(h, userId), emailJobs(api, kind): what F-20 recorded and enqueued.
// - twoStepRow(h, userId), recoveryCodeRows(h, userId): the stored two-step state.
// - limiterHits(h, limiters): the hits counted per F-29 limiter; FACTOR_LIMITERS lists the ones a
//   factor check can hit.
// - TOO_MANY_FACTORS: the exact VALIDATION_FAILED for two factors at once (A-99).
import type { Temporal } from "@budmon/shared";
import type { ApiSecretsCipher } from "../../src/platform/crypto/apiSecrets.js";
import type { DbHandle } from "../../src/platform/db/types.js";
import {
  passwordFactory,
  recoveryCodesFactory,
  twoStepFactory,
  TWO_STEP_SECRET,
  userFactory,
  type RecoveryRing,
} from "../factories/identity.js";
import type { UserRow } from "../../src/identity/usersRepo.js";
import type { IdentityApi } from "./identity.js";
import { jobRows } from "./jobs.js";

/** TWO_STEP_SECRET's bytes (what F-62 unseals). */
export const SECRET_BYTES = Buffer.from(TWO_STEP_SECRET, "utf8");

export function apiSecretsOf(api: IdentityApi): ApiSecretsCipher {
  const cipher = api.container.identity.deps.apiSecrets;
  if (cipher === null) throw new Error("the API has no apiSecrets");
  return cipher;
}

export function recoveryRingOf(api: IdentityApi): RecoveryRing {
  const keys = api.container.config.api?.recoveryCodeKeys;
  if (keys === undefined) throw new Error("the API config has no recovery-code keys");
  return keys.reveal();
}

export interface TwoStepUser {
  user: UserRow;
  codes: readonly string[];
}

/** A password user with two-step enabled at `now` and the known recovery codes (none used). */
export async function twoStepUser(
  api: IdentityApi,
  opts: {
    now: Temporal.Instant;
    overrides?: Parameters<typeof userFactory>[1];
    codesAcknowledged?: boolean;
    cipher?: ApiSecretsCipher;
  },
): Promise<TwoStepUser> {
  const h = api.testDb.database.handle;
  const user = await userFactory(h, opts.overrides ?? {});
  await passwordFactory(h, user.id);
  await twoStepFactory(h, opts.cipher ?? apiSecretsOf(api), {
    userId: user.id,
    now: opts.now,
    ...(opts.codesAcknowledged === undefined ? {} : { codesAcknowledged: opts.codesAcknowledged }),
  });
  const codes = await recoveryCodesFactory(h, recoveryRingOf(api), {
    userId: user.id,
    now: opts.now,
  });
  return { user, codes };
}

export const bearer = (accessToken: string): { authorization: string } => ({
  authorization: `Bearer ${accessToken}`,
});

export async function securityEvents(
  h: DbHandle,
  userId: string,
): Promise<{ id: string; kind: string }[]> {
  const { rows } = await h.executeSql(
    "SELECT id::text AS id, kind FROM security_events WHERE user_id = $1 ORDER BY created_at, id",
    [userId],
  );
  return rows.map((r) => ({ id: String(r["id"]), kind: String(r["kind"]) }));
}

/** The data of every queued identity.email-send job of `kind`, oldest first. */
export async function emailJobs(
  api: IdentityApi,
  kind: string,
): Promise<{ kind: string; refId: string; eventId: string }[]> {
  return (await jobRows(api.testDb.database, "identity.email-send"))
    .map((r) => r.data as { kind: string; refId: string; eventId: string })
    .filter((d) => d.kind === kind);
}

export interface TwoStepRowView {
  state: string;
  secretEnvelope: Buffer | null;
  pendingSecretEnvelope: Buffer | null;
  pendingExpiresAt: number | null;
  lastUsedStep: number | null;
  codesAcknowledged: boolean;
}

/** The user's two_step_credentials row, or null. */
export async function twoStepRow(h: DbHandle, userId: string): Promise<TwoStepRowView | null> {
  const { rows } = await h.executeSql(
    "SELECT state, secret_envelope, pending_secret_envelope, pending_expires_at, last_used_step, codes_acknowledged FROM two_step_credentials WHERE user_id = $1",
    [userId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    state: String(r["state"]),
    secretEnvelope: (r["secret_envelope"] as Buffer | null) ?? null,
    pendingSecretEnvelope: (r["pending_secret_envelope"] as Buffer | null) ?? null,
    pendingExpiresAt:
      r["pending_expires_at"] === null ? null : (r["pending_expires_at"] as Date).getTime(),
    lastUsedStep: r["last_used_step"] === null ? null : Number(r["last_used_step"]),
    codesAcknowledged: r["codes_acknowledged"] === true,
  };
}

/** The user's recovery_codes rows (id, key id, HMAC, used), by id. */
export async function recoveryCodeRows(
  h: DbHandle,
  userId: string,
): Promise<{ id: string; keyId: string; hmac: string; used: boolean }[]> {
  const { rows } = await h.executeSql(
    "SELECT id::text AS id, key_id, code_hmac, used_at FROM recovery_codes WHERE user_id = $1 ORDER BY id",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    keyId: String(r["key_id"]),
    hmac: (r["code_hmac"] as Buffer).toString("hex"),
    used: r["used_at"] !== null,
  }));
}

/** The TOTP SealContext F-62, F-63 and F-68 use for a user's envelopes. */
export const totpContext = (userId: string) => ({
  table: "two_step_credentials",
  rowId: userId,
  purpose: "totp",
});

/** The F-29 limiters a factor check (F-55, F-62, F-64, F-68) can hit. */
export const FACTOR_LIMITERS = [
  "twostep.ip",
  "twostep.totp-user",
  "twostep.totp-user-day",
  "confirm.ip",
  "confirm.user",
] as const;

/** Hits counted per limiter (F-29 names prefix the platform's bucket keys). */
export async function limiterHits(
  h: DbHandle,
  limiters: readonly string[] = FACTOR_LIMITERS,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const limiter of limiters) {
    const { rows } = await h.executeSql(
      "SELECT coalesce(sum(hits), 0)::int AS n FROM rate_limit_counters WHERE bucket_key LIKE $1",
      [`${limiter}:%`],
    );
    out[limiter] = Number(rows[0]?.["n"]);
  }
  return out;
}

/** VALIDATION_FAILED for more than one factor (identity LLD §6, A-99): one issue on path []. */
export const TOO_MANY_FACTORS = {
  defined: true,
  code: "VALIDATION_FAILED",
  status: 400,
  message: "Validation failed",
  data: {
    issues: [{ path: [], code: "too_many_factors", message: "Give exactly one factor" }],
  },
};
