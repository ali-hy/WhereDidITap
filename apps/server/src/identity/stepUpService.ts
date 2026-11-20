// F-55: `me.confirm`, the step-up that sets a session's confirmation time.
import type { Temporal } from "@budmon/shared";
import { withTransaction } from "../platform/db/transaction.js";
import { ValidationFailedError } from "../platform/errors/platformErrors.js";
import type { Principal } from "../platform/http/context.js";
import { CONFIRM_VALIDITY } from "./constants.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { InvalidCredentialsError, TwoStepCodeInvalidError } from "./identityErrors.js";
import type { IdentityDeps } from "./identityModule.js";
import { hitLimits } from "./limits.js";
import { confirmationFactor } from "./requireConfirmed.js";
import type { ReqInfo } from "./sessionService.js";
import * as sessionsRepo from "./sessionsRepo.js";
import { checkSecondFactor, requireOneFactor } from "./twoStepService.js";

export interface ConfirmInput {
  password: string | null;
  code: string | null;
  recoveryCode: string | null;
}

const issue = (field: string, code: string, message: string): ValidationFailedError =>
  new ValidationFailedError([{ path: [field], code, message }]);

const notAccepted = (field: string) => issue(field, "factor_not_accepted", "Factor not accepted");

/** Confirms the caller with the factor their account uses. */
export async function confirmIdentity(
  deps: IdentityDeps,
  principal: Principal,
  input: ConfirmInput,
  req: ReqInfo,
): Promise<{ confirmedUntil: Temporal.Instant }> {
  // More than one factor is a malformed request, whatever the account uses.
  if ([input.password, input.code, input.recoveryCode].filter((v) => v !== null).length > 1) {
    throw new ValidationFailedError([
      { path: [], code: "too_many_factors", message: "Give exactly one factor" },
    ]);
  }
  const pool = deps.database.handle;
  const factor = await confirmationFactor(deps, pool, principal.userId);

  if (factor === "google") throw notAccepted("password");
  if (factor === "two_step") {
    if (input.password !== null) throw notAccepted("password");
    if (input.code === null && input.recoveryCode === null) {
      throw issue("code", "required", "Required");
    }
    requireOneFactor(input);
    const accepted = await withTransaction(
      deps.database,
      async (tx) => {
        const check = await checkSecondFactor(deps, tx, principal.userId, input, req);
        if (!check.ok) return false;
        await sessionsRepo.setConfirmed(
          tx,
          principal.sessionId,
          new Date(deps.clock.now().epochMilliseconds),
        );
        return true;
      },
      { tracker: req.tracker },
    );
    if (!accepted) throw new TwoStepCodeInvalidError();
    return { confirmedUntil: deps.clock.now().add(CONFIRM_VALIDITY) };
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
