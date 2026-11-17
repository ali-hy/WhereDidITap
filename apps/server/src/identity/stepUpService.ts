// F-55: `me.confirm`, the step-up that sets a session's confirmation time.
import type { Temporal } from "@budmon/shared";
import { ValidationFailedError } from "../platform/errors/platformErrors.js";
import type { Principal } from "../platform/http/context.js";
import { CONFIRM_VALIDITY } from "./constants.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { InvalidCredentialsError } from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import { hitLimits } from "./limits.js";
import { confirmationFactor } from "./requireConfirmed.js";
import type { ReqInfo } from "./sessionService.js";
import * as sessionsRepo from "./sessionsRepo.js";

export interface ConfirmInput {
  password: string | null;
  code: string | null;
  recoveryCode: string | null;
}

const issue = (field: string, code: string, message: string): ValidationFailedError =>
  new ValidationFailedError([{ path: [field], code, message }]);

const notAccepted = (field: string) => issue(field, "factor_not_accepted", "Factor not accepted");

/** Confirms the caller with the factor their account uses; only the password factor so far. */
export async function confirmIdentity(
  deps: IdentityDeps,
  principal: Principal,
  input: ConfirmInput,
  req: ReqInfo,
): Promise<{ confirmedUntil: Temporal.Instant }> {
  const pool = deps.database.handle;
  const factor = await confirmationFactor(deps, pool, principal.userId);

  if (factor === "google") throw notAccepted("password");
  if (factor === "two_step") {
    if (input.password !== null) throw notAccepted("password");
    if (input.code === null && input.recoveryCode === null) {
      throw issue("code", "required", "Required");
    }
    // The code factors arrive with F-62 in S-4.
    throw new Error("me.confirm with a two-step code is built in S-4");
  }

  if (input.code !== null) throw notAccepted("code");
  if (input.recoveryCode !== null) throw notAccepted("recoveryCode");
  if (input.password === null) throw issue("password", "required", "Required");
  await hitLimits(deps, [
    { limiter: "confirm.ip", subject: req.ip },
    { limiter: "confirm.user", subject: principal.userId },
  ]);
  const stored = await credentialsRepo.getPasswordHash(pool, principal.userId);
  if (!(await deps.hasher.verify(stored?.hash ?? null, input.password))) {
    throw new InvalidCredentialsError();
  }

  const now = deps.clock.now();
  await sessionsRepo.setConfirmed(pool, principal.sessionId, new Date(now.epochMilliseconds));
  return { confirmedUntil: now.add(CONFIRM_VALIDITY) };
}
