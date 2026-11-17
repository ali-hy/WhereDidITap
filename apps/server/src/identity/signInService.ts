// F-50, F-51, F-52's commit step, F-58 and F-59: password sign-in and the sign-up options.
import { withTransaction } from "../platform/db/transaction.js";
import type { DbHandle } from "../platform/db/types.js";
import type { Config } from "../platform/config/schema.js";
import { TWO_STEP_CHALLENGE_TTL } from "./constants.js";
import * as bansRepo from "./bansRepo.js";
import * as challengesRepo from "./challengesRepo.js";
import type { PendingGoogleLink } from "./challengesRepo.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { deviceLabelFor } from "./deviceLabel.js";
import { normaliseEmail } from "./emailAddress.js";
import {
  AccountClosedError,
  GoogleAccountInUseError,
  InvalidCredentialsError,
} from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import { checkKnownDevice } from "./knownDevicesService.js";
import { hitLimits } from "./limits.js";
import { recordSecurityEvent } from "./securityEventsService.js";
import { createSession, type ReqInfo, type SignInOutcome } from "./sessionService.js";
import { generateToken, hashToken } from "./tokens.js";
import * as twoStepRepo from "./twoStepRepo.js";
import * as usersRepo from "./usersRepo.js";
import type { UserRow } from "./usersRepo.js";
import { acceptedLocales } from "./profileService.js";

export interface SignUpOptions {
  currencies: { code: string; minorUnits: number }[];
  locales: string[];
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new WeakMap<IdentityDeps, { at: number; value: SignUpOptions }>();

/** Active currencies and the locales a profile accepts; cached for ten minutes. */
export async function signUpOptions(deps: IdentityDeps): Promise<SignUpOptions> {
  const now = deps.clock.now().epochMilliseconds;
  const hit = cache.get(deps);
  if (hit !== undefined && now - hit.at < CACHE_MS) return hit.value;
  const { rows } = await deps.database.handle.executeSql(
    "SELECT code, minor_units FROM currencies WHERE is_active ORDER BY code",
  );
  const value: SignUpOptions = {
    currencies: rows.map((r) => ({
      code: r["code"] as string,
      minorUnits: r["minor_units"] as number,
    })),
    locales: [...acceptedLocales(deps)],
  };
  cache.set(deps, { at: now, value });
  return value;
}

const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d+)?$/;

/** The serialised origin of a URL string, or null when it isn't one. */
function originOf(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** F-58: which sign-in methods the caller's origin can use. */
export function authMethods(
  googleSignIn: NonNullable<Config["api"]>["googleSignIn"],
  origin: string | null,
): { password: true; google: "available" | "this_computer_only" | "unavailable" } {
  const caller = originOf(origin);
  if (
    googleSignIn === undefined ||
    caller === null ||
    !googleSignIn.appOrigins.some((o) => o.origin === caller)
  ) {
    return { password: true, google: "unavailable" };
  }
  const callback = googleSignIn.callbackOrigin.origin;
  if (LOCALHOST_ORIGIN.test(callback) && caller !== callback) {
    return { password: true, google: "this_computer_only" };
  }
  return { password: true, google: "available" };
}

const isGoogleLinkViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "23505" &&
  ["google_identities_sub_key", "google_identities_user_key"].includes(
    String((e as { constraint?: unknown }).constraint),
  );

/** A user who may not sign in: deleted by someone else, or on the ban list. */
async function isClosed(tx: DbHandle, user: UserRow): Promise<boolean> {
  if (user.status === "pending_deletion" && user.deletionRequestedBy !== "self") return true;
  return bansRepo.isBanned(tx, user.email);
}

interface CompleteInput {
  user: UserRow;
  method: "password" | "google";
  pendingLink: PendingGoogleLink | null;
  delivery: "cookie" | "bearer";
  presentedDeviceToken: string | null;
  rehash?: string | undefined;
}

/**
 * F-52's commit step, in the caller's transaction: re-checks closure under the user lock, commits
 * a pending Google link, then creates the session.
 */
export async function completeSignIn(
  deps: IdentityDeps,
  tx: DbHandle,
  input: CompleteInput,
  req: ReqInfo,
): Promise<Extract<SignInOutcome, { status: "signed_in" }>> {
  const user = await usersRepo.findById(tx, input.user.id, { lock: true });
  if (user === null || (await isClosed(tx, user))) throw new AccountClosedError();
  const now = deps.clock.now();

  if (input.pendingLink !== null) {
    try {
      await credentialsRepo.insertGoogle(tx, {
        id: deps.ids.next(),
        userId: user.id,
        googleSub: input.pendingLink.sub,
        emailAtLink: input.pendingLink.email,
        linkedAt: new Date(now.epochMilliseconds),
      });
    } catch (e) {
      if (isGoogleLinkViolation(e)) throw new GoogleAccountInUseError();
      throw e;
    }
    await recordSecurityEvent(deps, tx, {
      userId: user.id,
      kind: "google_linked_auto",
      clientKind: req.clientKind,
      email: "google_linked",
    });
  }
  if (input.rehash !== undefined) await credentialsRepo.upsertPassword(tx, user.id, input.rehash);

  const session = await createSession(deps, tx, {
    userId: user.id,
    delivery: input.delivery,
    clientKind: req.clientKind,
    deviceLabel: deviceLabelFor(req.clientKind, req.userAgent, req.deviceModel),
    authMethod: input.method,
    presentedDeviceToken: input.presentedDeviceToken,
  });
  await recordSecurityEvent(deps, tx, {
    userId: user.id,
    kind: "sign_in_succeeded",
    sessionId: session.sessionId,
    clientKind: req.clientKind,
  });
  deps.metrics.signIns.add(1, { method: input.method, error_key: "none" });
  return { status: "signed_in", session, recoveryCodesLeft: null };
}

/** F-51: after the first factor, either a two-step challenge or a signed-in session. */
export async function finishFirstFactor(
  deps: IdentityDeps,
  input: CompleteInput,
  req: ReqInfo,
): Promise<SignInOutcome> {
  return withTransaction(
    deps.database,
    async (tx): Promise<SignInOutcome> => {
      const twoStep = await twoStepRepo.get(tx, input.user.id);
      if (twoStep?.state !== "enabled") return completeSignIn(deps, tx, input, req);

      const now = deps.clock.now();
      const token = generateToken("challenge");
      const expiresAt = now.add(TWO_STEP_CHALLENGE_TTL);
      await challengesRepo.insert(tx, {
        id: deps.ids.next(),
        kind: "two_step",
        tokenHash: hashToken(token),
        userId: input.user.id,
        data: {
          kind: "two_step",
          delivery: input.delivery,
          method: input.method,
          pendingLink: input.pendingLink,
          clientKind: req.clientKind,
          deviceLabel: deviceLabelFor(req.clientKind, req.userAgent, req.deviceModel),
        },
        expiresAt: new Date(expiresAt.epochMilliseconds),
      });
      if (input.rehash !== undefined) {
        await credentialsRepo.upsertPassword(tx, input.user.id, input.rehash);
      }
      return {
        status: "two_step_required",
        challengeToken: token,
        expiresAt,
        delivery: input.delivery,
      };
    },
    { tracker: req.tracker },
  );
}

/** F-50: the password sign-in, with LD-1's limits and equal cost for unknown users. */
export async function signInWithPassword(
  deps: IdentityDeps,
  input: {
    email: string;
    password: string;
    delivery: "cookie" | "bearer";
    presentedDeviceToken: string | null;
  },
  req: ReqInfo,
): Promise<SignInOutcome> {
  const email = normaliseEmail(input.email);
  const pool = deps.database.handle;
  await hitLimits(deps, [{ limiter: "signin.ip", subject: req.ip }]);
  const known = await checkKnownDevice(deps, pool, input.presentedDeviceToken, email);
  await hitLimits(
    deps,
    known === null
      ? [
          { limiter: "signin.email-ip", subject: `${email}|${req.ip}` },
          { limiter: "signin.email-unknown-device", subject: email },
        ]
      : [{ limiter: "signin.email-device", subject: `${email}|${known.id}` }],
  );

  const user = await usersRepo.findByEmail(pool, email);
  const stored = user === null ? null : await credentialsRepo.getPasswordHash(pool, user.id);
  const ok = await deps.hasher.verify(stored?.hash ?? null, input.password);
  if (!ok || user === null || stored === null) {
    if (user !== null) {
      await withTransaction(
        deps.database,
        (tx) =>
          recordSecurityEvent(deps, tx, {
            userId: user.id,
            kind: "sign_in_failed",
            clientKind: req.clientKind,
          }),
        { tracker: req.tracker },
      );
    }
    deps.metrics.signIns.add(1, { method: "password", error_key: "INVALID_CREDENTIALS" });
    throw new InvalidCredentialsError();
  }
  // After a correct password, so a wrong one never reveals closure.
  if (await isClosed(pool, user)) {
    deps.metrics.signIns.add(1, { method: "password", error_key: "ACCOUNT_CLOSED" });
    throw new AccountClosedError();
  }
  const rehash = deps.hasher.needsRehash(stored.hash)
    ? await deps.hasher.hash(input.password)
    : undefined;
  try {
    return await finishFirstFactor(
      deps,
      {
        user,
        method: "password",
        pendingLink: null,
        delivery: input.delivery,
        presentedDeviceToken: input.presentedDeviceToken,
        rehash,
      },
      req,
    );
  } catch (e) {
    if (e instanceof AccountClosedError) {
      deps.metrics.signIns.add(1, { method: "password", error_key: "ACCOUNT_CLOSED" });
    }
    throw e;
  }
}
