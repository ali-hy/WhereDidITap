// F-1: identity's constants. Durations are Temporal.Duration values.
import { Temporal } from "@budmon/shared";

const { Duration } = Temporal;

export const ACCESS_TTL = Duration.from({ minutes: 15 });
export const REFRESH_IDLE_TTL = Duration.from({ hours: 30 * 24 });
export const REFRESH_RACE_WINDOW = Duration.from({ seconds: 60 });
export const REFRESH_PRUNE_AGE = Duration.from({ hours: 90 * 24 });
export const MAX_LIVE_SESSIONS = 20;
export const TWO_STEP_CHALLENGE_TTL = Duration.from({ minutes: 5 });
export const TWO_STEP_MAX_ATTEMPTS = 5;
export const CONFIRM_VALIDITY = Duration.from({ minutes: 10 });
export const GOOGLE_FLOW_TTL = Duration.from({ minutes: 10 });
export const HANDOFF_TTL = Duration.from({ minutes: 2 });
export const SIGNUP_TICKET_TTL = Duration.from({ minutes: 30 });
export const GOOGLE_CONFIRM_MAX_AGE = Duration.from({ minutes: 5 });
export const RESET_TTL = Duration.from({ minutes: 30 });
export const RESET_MAX_OUTSTANDING = 3;
export const RESET_MAX_FAILED_CODES = 5;
export const INVITATION_TTL = Duration.from({ hours: 7 * 24 });
export const INVITATION_RESENDS_PER_DAY = 3;
export const DEFAULT_INVITE_ALLOWANCE = 3;
export const DEFAULT_USER_CAP = 90;
export const TOTP_SETUP_TTL = Duration.from({ minutes: 15 });
export const RECOVERY_CODE_COUNT = 10;
export const DELETION_GRACE = Duration.from({ hours: 7 * 24 });
export const EXPORT_TTL = Duration.from({ hours: 7 * 24 });
export const EXPORTS_PER_DAY = 3;
export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;
export const KNOWN_DEVICE_TTL = Duration.from({ hours: 365 * 24 });
export const MAX_KNOWN_DEVICES = 20;
export const SECURITY_EVENT_RETENTION = Duration.from({ hours: 90 * 24 });
export const ENDED_SESSION_RETENTION = Duration.from({ hours: 30 * 24 });
export const ENDED_INVITATION_RETENTION = Duration.from({ hours: 90 * 24 });
export const EXPORT_ROW_RETENTION = Duration.from({ hours: 30 * 24 });
export const RECENT_ACCEPT_WINDOW = Duration.from({ minutes: 10 });
export const ARGON2_MAX_CONCURRENCY = 4;
export const SUPPORTED_LOCALES: readonly string[] = ["en"];
export const PSEUDO_LOCALES: readonly string[] = ["en-XA", "ar-XB"];

export const SECURITY_EVENT_KINDS = [
  "sign_in_succeeded",
  "sign_in_failed",
  "sign_up",
  "two_step_failed_sign_in",
  "two_step_enabled",
  "two_step_disabled",
  "two_step_reset_by_owner",
  "authenticator_replaced",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "password_changed",
  "password_added",
  "password_reset",
  "google_linked_auto",
  "google_linked",
  "google_unlinked",
  "session_revoked",
  "refresh_reuse_detected",
  "deletion_requested",
  "deletion_cancelled",
  "deletion_by_owner",
  "deletion_cancelled_by_owner",
  "banned",
  "export_requested",
] as const;

export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];
