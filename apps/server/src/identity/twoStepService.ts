// F-62 to F-68: the second factor check and the management of two-step verification.
import type { Temporal } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import type { DbHandle } from "../platform/db/types.js";
import { ValidationFailedError } from "../platform/errors/platformErrors.js";
import type { Principal } from "../platform/http/context.js";
import type { ApiSecretsCipher } from "../platform/crypto/apiSecrets.js";
import { base32Encode } from "./base32.js";
import { APP_NAME, RECOVERY_CODE_COUNT, TOTP_SETUP_TTL } from "./constants.js";
import {
  TwoStepAlreadyEnabledError,
  TwoStepCodeInvalidError,
  TwoStepNotEnabledError,
  TwoStepSetupExpiredError,
} from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import { hitLimits } from "./limits.js";
import {
  currentKeyHmac,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  recoveryCodeHmacs,
} from "./recoveryCodes.js";
import { requireConfirmedTx } from "./requireConfirmed.js";
import { recordSecurityEvent } from "./securityEventsService.js";
import { revokeAllSessionsTx, type ReqInfo } from "./sessionService.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";
import * as twoStepRepo from "./twoStepRepo.js";
import * as usersRepo from "./usersRepo.js";

export interface SetupInfo {
  secret: string;
  otpauthUri: string;
  expiresAt: Temporal.Instant;
}

const toDate = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);
const epochSeconds = (i: Temporal.Instant): number => Math.floor(i.epochMilliseconds / 1000);

/** Both envelope columns use one context, so a swap moves the bytes unchanged. */
const sealContext = (userId: string) => ({
  table: "two_step_credentials",
  rowId: userId,
  purpose: "totp",
});

function cipherOf(deps: IdentityDeps): ApiSecretsCipher {
  if (deps.apiSecrets === null) throw new Error("two-step needs the API's secrets cipher");
  return deps.apiSecrets;
}

function recoveryKeysOf(deps: IdentityDeps): {
  current: string;
  keys: ReadonlyMap<string, Buffer>;
} {
  const keys = deps.config.api?.recoveryCodeKeys;
  if (keys === undefined) throw new Error("two-step needs the recovery-code keys");
  return keys.reveal();
}

/** The base32 secret in groups of four, separated by one space. */
const groupSecret = (secret: Buffer): string =>
  base32Encode(secret)
    .match(/.{1,4}/g)
    ?.join(" ") ?? "";

/** The code factors take exactly one of a code and a recovery code. */
export function requireOneFactor(f: { code: string | null; recoveryCode: string | null }): void {
  if (f.code === null && f.recoveryCode === null) {
    throw new ValidationFailedError([{ path: ["code"], code: "required", message: "Required" }]);
  }
  if (f.code !== null && f.recoveryCode !== null) {
    throw new ValidationFailedError([
      { path: [], code: "too_many_factors", message: "Give exactly one factor" },
    ]);
  }
}

/** F-62, in the caller's transaction. A wrong factor is `ok: false`; the caller decides what follows. */
export async function checkSecondFactor(
  deps: IdentityDeps,
  h: DbHandle,
  userId: string,
  f: { code: string | null; recoveryCode: string | null },
  req: ReqInfo,
): Promise<{ ok: boolean; method: "totp" | "recovery" }> {
  const now = deps.clock.now();
  const method = f.code === null ? "recovery" : "totp";
  let ok = false;
  if (f.code !== null) {
    await hitLimits(deps, [
      { limiter: "twostep.ip", subject: req.ip },
      { limiter: "twostep.totp-user", subject: userId },
      { limiter: "twostep.totp-user-day", subject: userId },
    ]);
    const row = await twoStepRepo.get(h, userId, { lock: true });
    if (row?.state === "enabled" && row.secretEnvelope !== null) {
      const secret = cipherOf(deps).unseal(row.secretEnvelope, sealContext(userId));
      const step = verifyTotp(secret, f.code, epochSeconds(now), row.lastUsedStep);
      if (step !== null) {
        await twoStepRepo.setLastUsedStep(h, userId, step);
        ok = true;
      }
    }
  } else {
    // No per-user limiter: a person locked out of their authenticator can still use a code (D-8).
    await hitLimits(deps, [{ limiter: "twostep.ip", subject: req.ip }]);
    const normalised = f.recoveryCode === null ? null : normaliseRecoveryCode(f.recoveryCode);
    if (normalised !== null) {
      const hit = await twoStepRepo.findUnusedCode(
        h,
        userId,
        recoveryCodeHmacs(normalised, recoveryKeysOf(deps)),
        { lock: true },
      );
      if (hit !== null) {
        await twoStepRepo.markCodeUsed(h, hit.id, toDate(now));
        ok = true;
      }
    }
  }
  deps.metrics.twoStep.add(1, { method, error_key: ok ? "none" : "TWO_STEP_CODE_INVALID" });
  return { ok, method };
}

/** A new secret sealed and written as the pending one; shared by F-63 and F-68's start. */
async function startPending(deps: IdentityDeps, h: DbHandle, userId: string): Promise<SetupInfo> {
  const user = await usersRepo.findById(h, userId);
  if (user === null) throw new TwoStepNotEnabledError();
  const secret = generateTotpSecret();
  const expiresAt = deps.clock.now().add(TOTP_SETUP_TTL);
  await twoStepRepo.upsertPending(
    h,
    userId,
    cipherOf(deps).seal(secret, sealContext(userId)),
    toDate(expiresAt),
  );
  return {
    secret: groupSecret(secret),
    otpauthUri: otpauthUri({ secret, accountEmail: user.email, issuer: APP_NAME }),
    expiresAt,
  };
}

/** F-63. */
export async function twoStepSetup(deps: IdentityDeps, principal: Principal): Promise<SetupInfo> {
  return withTransaction(deps.database, async (tx) => {
    await requireConfirmedTx(deps, tx, principal);
    const row = await twoStepRepo.get(tx, principal.userId, { lock: true });
    if (row?.state === "enabled") throw new TwoStepAlreadyEnabledError();
    return startPending(deps, tx, principal.userId);
  });
}

/** F-64: turns two-step on; the recovery codes leave the server only here. */
export async function twoStepEnable(
  deps: IdentityDeps,
  principal: Principal,
  input: { code: string },
  req: ReqInfo,
): Promise<{ recoveryCodes: string[] }> {
  return withTransaction(
    deps.database,
    async (tx) => {
      await requireConfirmedTx(deps, tx, principal);
      const now = deps.clock.now();
      const row = await twoStepRepo.get(tx, principal.userId, { lock: true });
      if (row?.state === "enabled") throw new TwoStepAlreadyEnabledError();
      if (
        row === null ||
        row.pendingSecretEnvelope === null ||
        row.pendingExpiresAt === null ||
        row.pendingExpiresAt.getTime() <= now.epochMilliseconds
      ) {
        throw new TwoStepSetupExpiredError();
      }
      await hitLimits(deps, [
        { limiter: "twostep.ip", subject: req.ip },
        { limiter: "twostep.totp-user", subject: principal.userId },
        { limiter: "twostep.totp-user-day", subject: principal.userId },
      ]);
      const secret = cipherOf(deps).unseal(
        row.pendingSecretEnvelope,
        sealContext(principal.userId),
      );
      const step = verifyTotp(secret, input.code, epochSeconds(now), null);
      if (step === null) throw new TwoStepCodeInvalidError();

      await twoStepRepo.enable(tx, principal.userId, toDate(now));
      await twoStepRepo.setLastUsedStep(tx, principal.userId, step);
      const codes = await replaceCodes(deps, tx, principal.userId);
      await revokeAllSessionsTx(
        deps,
        tx,
        principal.userId,
        "two_step_enabled",
        now,
        principal.sessionId,
      );
      await recordSecurityEvent(deps, tx, {
        userId: principal.userId,
        kind: "two_step_enabled",
        sessionId: principal.sessionId,
        clientKind: req.clientKind,
        email: "two_step_enabled",
      });
      return { recoveryCodes: codes };
    },
    { tracker: req.tracker },
  );
}

/** New codes, stored only as HMACs under the current key; returns them formatted. */
async function replaceCodes(deps: IdentityDeps, h: DbHandle, userId: string): Promise<string[]> {
  const ring = recoveryKeysOf(deps);
  const formatted = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await twoStepRepo.replaceRecoveryCodes(
    h,
    userId,
    formatted.map((code) => {
      const { keyId, hmac } = currentKeyHmac(normaliseRecoveryCode(code) ?? "", ring);
      return { id: deps.ids.next(), keyId, hmac };
    }),
  );
  return formatted;
}

/** F-65. */
export async function acknowledgeRecoveryCodes(
  deps: IdentityDeps,
  principal: Principal,
): Promise<void> {
  const pool = deps.database.handle;
  const row = await twoStepRepo.get(pool, principal.userId);
  if (row?.state !== "enabled") throw new TwoStepNotEnabledError();
  await twoStepRepo.setCodesAcknowledged(pool, principal.userId, true);
}

/** F-66. */
export async function twoStepDisable(
  deps: IdentityDeps,
  principal: Principal,
  input: { code: string | null; recoveryCode: string | null },
  req: ReqInfo,
): Promise<void> {
  requireOneFactor(input);
  const row = await twoStepRepo.get(deps.database.handle, principal.userId);
  if (row?.state !== "enabled") throw new TwoStepNotEnabledError();
  await withTransaction(
    deps.database,
    async (tx) => {
      const check = await checkSecondFactor(deps, tx, principal.userId, input, req);
      if (!check.ok) throw new TwoStepCodeInvalidError();
      await twoStepRepo.remove(tx, principal.userId);
      await recordSecurityEvent(deps, tx, {
        userId: principal.userId,
        kind: "two_step_disabled",
        sessionId: principal.sessionId,
        clientKind: req.clientKind,
        email: "two_step_disabled",
      });
    },
    { tracker: req.tracker },
  );
}

/** F-67. */
export async function regenerateRecoveryCodes(
  deps: IdentityDeps,
  principal: Principal,
  req: ReqInfo,
): Promise<{ recoveryCodes: string[] }> {
  return withTransaction(
    deps.database,
    async (tx) => {
      await requireConfirmedTx(deps, tx, principal);
      const row = await twoStepRepo.get(tx, principal.userId, { lock: true });
      if (row?.state !== "enabled") throw new TwoStepNotEnabledError();
      const codes = await replaceCodes(deps, tx, principal.userId);
      await twoStepRepo.setCodesAcknowledged(tx, principal.userId, false);
      await recordSecurityEvent(deps, tx, {
        userId: principal.userId,
        kind: "recovery_codes_regenerated",
        sessionId: principal.sessionId,
        clientKind: req.clientKind,
        email: "recovery_codes_regenerated",
      });
      return { recoveryCodes: codes };
    },
    { tracker: req.tracker },
  );
}

/** F-68, start: a new secret waits beside the current one. */
export async function twoStepReplaceStart(
  deps: IdentityDeps,
  principal: Principal,
): Promise<SetupInfo> {
  return withTransaction(deps.database, async (tx) => {
    await requireConfirmedTx(deps, tx, principal);
    const row = await twoStepRepo.get(tx, principal.userId, { lock: true });
    if (row?.state !== "enabled") throw new TwoStepNotEnabledError();
    return startPending(deps, tx, principal.userId);
  });
}

/** F-68, confirm: the new secret replaces the old one; recovery codes and sessions stay. */
export async function twoStepReplaceConfirm(
  deps: IdentityDeps,
  principal: Principal,
  input: { code: string },
  req: ReqInfo,
): Promise<void> {
  await withTransaction(
    deps.database,
    async (tx) => {
      const now = deps.clock.now();
      const row = await twoStepRepo.get(tx, principal.userId, { lock: true });
      if (row?.state !== "enabled") throw new TwoStepNotEnabledError();
      if (
        row.pendingSecretEnvelope === null ||
        row.pendingExpiresAt === null ||
        row.pendingExpiresAt.getTime() <= now.epochMilliseconds
      ) {
        throw new TwoStepSetupExpiredError();
      }
      await hitLimits(deps, [
        { limiter: "twostep.ip", subject: req.ip },
        { limiter: "twostep.totp-user", subject: principal.userId },
        { limiter: "twostep.totp-user-day", subject: principal.userId },
      ]);
      const secret = cipherOf(deps).unseal(
        row.pendingSecretEnvelope,
        sealContext(principal.userId),
      );
      // The new secret has no used steps yet.
      const step = verifyTotp(secret, input.code, epochSeconds(now), null);
      if (step === null) throw new TwoStepCodeInvalidError();
      await twoStepRepo.swapPending(tx, principal.userId);
      await twoStepRepo.setLastUsedStep(tx, principal.userId, step);
      await recordSecurityEvent(deps, tx, {
        userId: principal.userId,
        kind: "authenticator_replaced",
        sessionId: principal.sessionId,
        clientKind: req.clientKind,
        email: "authenticator_replaced",
      });
    },
    { tracker: req.tracker },
  );
}
