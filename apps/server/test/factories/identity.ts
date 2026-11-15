// Identity's factories (identity LLD §10.1), owned by the test-architect. Each writes through
// identity's repos on a DbHandle and returns what tests need (plain tokens included). Later slices
// add the known-code recovery factory and the export factory.
import { randomBytes } from "node:crypto";
import { Temporal, uuidv7Generator } from "@budmon/shared";
import type { DbHandle } from "../../src/platform/db/types.js";
import type { ApiSecretsCipher } from "../../src/platform/crypto/apiSecrets.js";
import * as bansRepo from "../../src/identity/bansRepo.js";
import * as invitationsRepo from "../../src/identity/invitationsRepo.js";
import * as twoStepRepo from "../../src/identity/twoStepRepo.js";
import * as knownDevicesRepo from "../../src/identity/knownDevicesRepo.js";
import * as resetsRepo from "../../src/identity/resetsRepo.js";
import * as sessionsRepo from "../../src/identity/sessionsRepo.js";
import * as credentialsRepo from "../../src/identity/credentialsRepo.js";
import * as usersRepo from "../../src/identity/usersRepo.js";
import type { UserRow } from "../../src/identity/usersRepo.js";
import { generateToken, hashToken } from "../../src/identity/tokens.js";

/** §10.1: the factories' known password. */
export const FACTORY_PASSWORD = "correct horse battery";
/** FACTORY_PASSWORD hashed at P-F-66's parameters (m=19456,t=2,p=1), so tests skip Argon2id. */
export const FACTORY_PASSWORD_PHC =
  "$argon2id$v=19$m=19456,t=2,p=1$nbQctopfMt/Rxtnnd7Vmjw$gfhUfLyXl09eRzeAGN5Io/+iZ/h4Cim32CsaUxZNnqE";

const ids = uuidv7Generator;
let sequence = 0;

const toDate = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);

/** A user row with defaults (active, en, UTC, USD, allowance 3); `overrides` on top. */
export async function userFactory(
  h: DbHandle,
  overrides: Partial<Omit<UserRow, "createdAt" | "lastActiveAt">> = {},
): Promise<UserRow> {
  sequence += 1;
  const id = overrides.id ?? ids.next();
  const row: Omit<UserRow, "createdAt" | "lastActiveAt"> = {
    id,
    email: `user-${String(sequence)}-${id.slice(-12)}@example.invalid`,
    emailVerifiedAt: new Date(),
    displayName: "Test User",
    locale: "en",
    timeZone: "UTC",
    baseCurrency: "USD",
    status: "active",
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    deletionRequestedBy: null,
    isProductOwner: false,
    inviteAllowance: 3,
    invitedByUserId: null,
    ...overrides,
  };
  await usersRepo.insert(h, row);
  const stored = await usersRepo.findById(h, id);
  if (stored === null) throw new Error("userFactory: the user wasn't stored");
  return stored;
}

/** Sets the user's password to FACTORY_PASSWORD (or `phc`). */
export async function passwordFactory(
  h: DbHandle,
  userId: string,
  phc: string = FACTORY_PASSWORD_PHC,
): Promise<void> {
  await credentialsRepo.upsertPassword(h, userId, phc);
}

export interface FactorySession {
  sessionId: string;
  refreshId: string;
  accessToken: string;
  refreshToken: string;
}

/** A session with its first refresh token; expiries relative to `now` unless given. */
export async function sessionFactory(
  h: DbHandle,
  input: {
    userId: string;
    now: Temporal.Instant;
    delivery?: "cookie" | "bearer";
    clientKind?: "web" | "android" | "other";
    authMethod?: "password" | "google" | "reset" | "sign_up";
    accessExpiresAt?: Temporal.Instant;
    idleExpiresAt?: Temporal.Instant;
    lastUsedAt?: Temporal.Instant;
    confirmedAt?: Temporal.Instant;
    revoked?: { reason: string; at: Temporal.Instant };
  },
): Promise<FactorySession> {
  const sessionId = ids.next();
  const refreshId = ids.next();
  const accessToken = generateToken("access");
  const refreshToken = generateToken("refresh");
  await sessionsRepo.insertSession(h, {
    id: sessionId,
    userId: input.userId,
    delivery: input.delivery ?? "bearer",
    clientKind: input.clientKind ?? "android",
    deviceLabel: "Android · Test",
    authMethod: input.authMethod ?? "password",
    accessTokenHash: hashToken(accessToken),
    accessExpiresAt: toDate(input.accessExpiresAt ?? input.now.add({ minutes: 15 })),
    currentRefreshId: refreshId,
    idleExpiresAt: toDate(input.idleExpiresAt ?? input.now.add({ hours: 24 * 30 })),
    confirmedAt: toDate(input.confirmedAt ?? input.now),
    lastUsedAt: toDate(input.lastUsedAt ?? input.now),
  });
  await sessionsRepo.insertRefresh(h, {
    id: refreshId,
    sessionId,
    parentId: null,
    generation: 1,
    tokenHash: hashToken(refreshToken),
    issuedAt: toDate(input.now),
  });
  if (input.revoked !== undefined) {
    await sessionsRepo.revoke(h, sessionId, input.revoked.reason, toDate(input.revoked.at));
  }
  return { sessionId, refreshId, accessToken, refreshToken };
}

/** A direct (or given-origin) invitation; with `withToken`, a known plain token is stored. */
export async function invitationFactory(
  h: DbHandle,
  input: {
    email: string;
    now: Temporal.Instant;
    inviterUserId?: string | null;
    origin?: "direct" | "account_share" | "bootstrap";
    expiresAt?: Temporal.Instant;
    withToken?: boolean;
    revokedAt?: Temporal.Instant;
  },
): Promise<{ invitationId: string; token: string | null }> {
  const invitationId = ids.next();
  const token = input.withToken === true ? generateToken("invitation") : null;
  await invitationsRepo.insert(h, {
    id: invitationId,
    email: input.email,
    inviterUserId: input.inviterUserId ?? null,
    origin: input.origin ?? "direct",
    expiresAt: toDate(input.expiresAt ?? input.now.add({ hours: 24 * 7 })),
    tokenHash: token === null ? null : hashToken(token),
    tokenIssuedAt: token === null ? null : toDate(input.now),
  });
  if (input.revokedAt !== undefined) {
    await invitationsRepo.revoke(h, invitationId, null, toDate(input.revokedAt));
  }
  return { invitationId, token };
}

/** A password-reset row (no token until the email job issues one). */
export async function resetFactory(
  h: DbHandle,
  input: {
    userId: string;
    now: Temporal.Instant;
    expiresAt?: Temporal.Instant;
    usedAt?: Temporal.Instant;
  },
): Promise<{ resetId: string }> {
  const resetId = ids.next();
  await resetsRepo.insert(h, {
    id: resetId,
    userId: input.userId,
    expiresAt: toDate(input.expiresAt ?? input.now.add({ minutes: 30 })),
  });
  if (input.usedAt !== undefined) await resetsRepo.markUsed(h, resetId, toDate(input.usedAt));
  return { resetId };
}

/** A known device for `userId`; returns its plain token. */
export async function knownDeviceFactory(
  h: DbHandle,
  input: { userId: string; now: Temporal.Instant; expiresAt?: Temporal.Instant },
): Promise<{ deviceId: string; token: string }> {
  const deviceId = ids.next();
  const token = generateToken("device");
  await knownDevicesRepo.insert(h, {
    id: deviceId,
    userId: input.userId,
    tokenHash: hashToken(token),
    lastUsedAt: toDate(input.now),
    expiresAt: toDate(input.expiresAt ?? input.now.add({ hours: 24 * 365 })),
  });
  return { deviceId, token };
}

/** Marks an invitation accepted by `userId` at `at`. */
export async function acceptInvitationRow(
  h: DbHandle,
  invitationId: string,
  userId: string,
  at: Temporal.Instant,
): Promise<void> {
  await invitationsRepo.markAccepted(h, invitationId, userId, toDate(at));
}

/** Bans `email` (no banning user). */
export async function banFactory(h: DbHandle, input: { email: string; now: Temporal.Instant }) {
  await bansRepo.insertBan(h, {
    email: input.email,
    bannedAt: toDate(input.now),
    bannedByUserId: null,
  });
}

/** A linked Google identity; returns its sub. */
export async function googleIdentityFactory(
  h: DbHandle,
  input: { userId: string; email: string; now: Temporal.Instant; sub?: string },
): Promise<{ id: string; sub: string }> {
  const id = ids.next();
  const sub = input.sub ?? `sub-${id.slice(-12)}`;
  await credentialsRepo.insertGoogle(h, {
    id,
    userId: input.userId,
    googleSub: sub,
    emailAtLink: input.email,
    linkedAt: toDate(input.now),
  });
  return { id, sub };
}

/** §10.1: the known TOTP secret (RFC 6238's test secret). */
export const TWO_STEP_SECRET = "12345678901234567890";

/**
 * Two-step enabled with TWO_STEP_SECRET, sealed with `apiSecrets` (SealContext
 * { table: "two_step_credentials", rowId: userId, purpose: "totp" }), and `recoveryCodes` unused
 * codes (placeholder HMACs: they count, but don't verify; S-4 adds known codes).
 */
export async function twoStepFactory(
  h: DbHandle,
  apiSecrets: ApiSecretsCipher,
  input: {
    userId: string;
    now: Temporal.Instant;
    recoveryCodes?: number;
    usedRecoveryCodes?: number;
    codesAcknowledged?: boolean;
  },
): Promise<void> {
  const envelope = apiSecrets.seal(Buffer.from(TWO_STEP_SECRET, "utf8"), {
    table: "two_step_credentials",
    rowId: input.userId,
    purpose: "totp",
  });
  await twoStepRepo.upsertPending(
    h,
    input.userId,
    envelope,
    toDate(input.now.add({ minutes: 15 })),
  );
  await twoStepRepo.enable(h, input.userId, toDate(input.now));
  if (input.codesAcknowledged === true) {
    await twoStepRepo.setCodesAcknowledged(h, input.userId, true);
  }
  const unused = input.recoveryCodes ?? 10;
  const used = input.usedRecoveryCodes ?? 0;
  const codes = Array.from({ length: unused + used }, () => ({
    id: ids.next(),
    keyId: apiSecrets.currentKeyId(),
    hmac: randomBytes(32),
  }));
  await twoStepRepo.replaceRecoveryCodes(h, input.userId, codes);
  for (const code of codes.slice(unused)) {
    await twoStepRepo.markCodeUsed(h, code.id, toDate(input.now));
  }
}
