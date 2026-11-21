// F-56 getMe and F-90 validateProfile (updateProfile arrives with S-7).
import { isValidTimeZone, Temporal } from "@budmon/shared";
import type { DbHandle } from "../platform/db/types.js";
import { NotFoundError, type Issue } from "../platform/errors/platformErrors.js";

import type { Principal } from "../platform/http/context.js";
import { CONFIRM_VALIDITY, PSEUDO_LOCALES, SUPPORTED_LOCALES } from "./constants.js";
import * as credentialsRepo from "./credentialsRepo.js";
import type { IdentityDeps } from "./identityModule.js";
import * as sessionsRepo from "./sessionsRepo.js";
import * as twoStepRepo from "./twoStepRepo.js";
import * as usersRepo from "./usersRepo.js";

export interface Me {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timeZone: string;
  baseCurrency: string;
  status: "active" | "pending_deletion";
  deletionScheduledFor: Temporal.Instant | null;
  isOwner: boolean;
  hasPassword: boolean;
  passwordUpdatedAt: Temporal.Instant | null;
  google: { email: string } | null;
  twoStep: { enabled: boolean; recoveryCodesLeft: number; codesAcknowledged: boolean };
  confirmedUntil: Temporal.Instant | null;
  sessionId: string;
}

const instant = (d: Date): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(d.getTime());

/** Reads only: the user, credentials, two-step row and the caller's session. */
export async function getMe(deps: IdentityDeps, principal: Principal): Promise<Me> {
  const h = deps.database.handle;
  const user = await usersRepo.findById(h, principal.userId);
  const session = await sessionsRepo.findById(h, principal.sessionId);
  if (user === null || session === null) throw new NotFoundError();
  const password = await credentialsRepo.getPasswordHash(h, user.id);
  const google = await credentialsRepo.findGoogleByUser(h, user.id);
  const twoStep = await twoStepRepo.get(h, user.id);
  const enabled = twoStep?.state === "enabled";
  const confirmedUntil =
    session.confirmedAt === null ? null : instant(session.confirmedAt).add(CONFIRM_VALIDITY);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    timeZone: user.timeZone,
    baseCurrency: user.baseCurrency,
    status: user.status,
    deletionScheduledFor:
      user.deletionScheduledFor === null ? null : instant(user.deletionScheduledFor),
    isOwner: user.isProductOwner,
    hasPassword: password !== null,
    passwordUpdatedAt: password === null ? null : instant(password.updatedAt),
    google: google === null ? null : { email: google.emailAtLink },
    twoStep: {
      enabled,
      recoveryCodesLeft: enabled ? await twoStepRepo.countUnusedCodes(h, user.id) : 0,
      codesAcknowledged: twoStep?.codesAcknowledged ?? false,
    },
    confirmedUntil:
      confirmedUntil !== null && Temporal.Instant.compare(confirmedUntil, deps.clock.now()) > 0
        ? confirmedUntil
        : null,
    sessionId: session.id,
  };
}

export interface ProfileFields {
  displayName?: string;
  locale?: string;
  timeZone?: string;
  baseCurrency?: string;
}

const issue = (field: string, code: string, message: string): Issue => ({
  path: [field],
  code,
  message,
});

/** The locales a profile accepts: pseudo-locales only in development and test. */
export function acceptedLocales(deps: Pick<IdentityDeps, "config">): readonly string[] {
  const env = deps.config.appEnv;
  return env === "development" || env === "test"
    ? [...SUPPORTED_LOCALES, ...PSEUDO_LOCALES]
    : SUPPORTED_LOCALES;
}

/** Returns the canonical values, and the issues for those that fail. */
export async function validateProfile(
  deps: Pick<IdentityDeps, "config">,
  h: DbHandle,
  p: ProfileFields,
): Promise<{ value: ProfileFields; issues: Issue[] }> {
  const value: ProfileFields = {};
  const issues: Issue[] = [];

  if (p.displayName !== undefined) {
    const name = p.displayName.normalize("NFC").trim();
    const length = Array.from(name).length;
    if (length < 1) issues.push(issue("displayName", "too_small", "Too small"));
    else if (length > 80) issues.push(issue("displayName", "too_big", "Too big"));
    else if (/\p{Cc}/u.test(name))
      issues.push(issue("displayName", "invalid_format", "Invalid format"));
    else value.displayName = name;
  }

  if (p.locale !== undefined) {
    if (acceptedLocales(deps).includes(p.locale)) value.locale = p.locale;
    else issues.push(issue("locale", "unsupported_locale", "Unsupported locale"));
  }

  if (p.timeZone !== undefined) {
    if (isValidTimeZone(p.timeZone)) {
      value.timeZone = new Intl.DateTimeFormat("en", {
        timeZone: p.timeZone,
      }).resolvedOptions().timeZone;
    } else issues.push(issue("timeZone", "invalid_time_zone", "Invalid time zone"));
  }

  if (p.baseCurrency !== undefined) {
    const { rows } = await h.executeSql("SELECT 1 FROM currencies WHERE code = $1 AND is_active", [
      p.baseCurrency,
    ]);
    if (rows.length > 0) value.baseCurrency = p.baseCurrency;
    else issues.push(issue("baseCurrency", "unknown_currency", "Unknown currency"));
  }

  return { value, issues };
}
