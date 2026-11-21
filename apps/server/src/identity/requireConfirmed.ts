// F-28: step-up helpers. A session is "confirmed" for CONFIRM_VALIDITY after its last step-up.
import type { DbHandle } from "../platform/db/types.js";
import { UnauthenticatedError } from "../platform/errors/platformErrors.js";
import type { Principal, RequestContext } from "../platform/http/context.js";
import { CONFIRM_VALIDITY } from "./constants.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { ConfirmationRequiredError, type ConfirmationFactor } from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import * as sessionsRepo from "./sessionsRepo.js";
import * as twoStepRepo from "./twoStepRepo.js";

const DEFAULT_MAX_AGE_SECONDS = CONFIRM_VALIDITY.total("seconds");

/** The factor a step-up uses: two-step, else password, else Google. */
export async function confirmationFactor(
  _deps: IdentityDeps,
  h: DbHandle,
  userId: string,
): Promise<ConfirmationFactor> {
  const twoStep = await twoStepRepo.get(h, userId);
  if (twoStep?.state === "enabled") return "two_step";
  if ((await credentialsRepo.getPasswordHash(h, userId)) !== null) return "password";
  return "google";
}

/** Passes when the session was confirmed within `maxAgeSeconds` (1..600, inclusive). */
export async function requireConfirmedTx(
  deps: IdentityDeps,
  h: DbHandle,
  principal: Principal,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): Promise<void> {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600) {
    throw new RangeError("maxAgeSeconds must be an integer from 1 to 600");
  }
  const session = await sessionsRepo.findById(h, principal.sessionId);
  if (session === null) throw new UnauthenticatedError();
  const limit = deps.clock.now().epochMilliseconds - maxAgeSeconds * 1000;
  if (session.confirmedAt !== null && session.confirmedAt.getTime() >= limit) return;
  throw new ConfirmationRequiredError(await confirmationFactor(deps, h, principal.userId));
}

/** For other modules: the same check on a pool handle. */
export function requireConfirmed(
  ctx: RequestContext & { principal: Principal },
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
): Promise<void> {
  const deps = ctx.container.identity.deps;
  return requireConfirmedTx(deps, deps.database.handle, ctx.principal, maxAgeSeconds);
}
