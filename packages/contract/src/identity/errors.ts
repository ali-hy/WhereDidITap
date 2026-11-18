// F-35, §6: identity's error map. Each procedure declares the errors it can throw from here.
import { z } from "zod";
import { InstantWire } from "../common/dates.js";
import { UuidSchema } from "../common/ids.js";

const email = z.object({ email: z.string() });
/** Who the invitation came from (A-58). */
const invitationContext = {
  inviterName: z.string().nullable(),
  origin: z.enum(["direct", "account_share", "bootstrap"]),
};
const retryAfter = z.object({ retryAfterSeconds: z.number().int().min(1) });

export const IDENTITY_ERRORS = {
  INVALID_CREDENTIALS: { status: 401, message: "Invalid credentials" },
  ACCOUNT_CLOSED: { status: 403, message: "Account closed" },
  TWO_STEP_CHALLENGE_EXPIRED: {
    status: 401,
    message: "Two-step challenge expired",
    data: z.object({ reason: z.enum(["too_many_attempts", "expired"]) }),
  },
  TWO_STEP_CODE_INVALID: {
    status: 400,
    message: "Invalid two-step code",
    data: z.object({ attemptsLeft: z.number().int().min(0).optional() }),
  },
  REFRESH_INVALID: { status: 401, message: "Refresh token invalid" },
  CONFIRMATION_REQUIRED: {
    status: 403,
    message: "Confirmation required",
    data: z.object({ factor: z.enum(["two_step", "password", "google"]) }),
  },
  PASSWORD_TOO_WEAK: {
    status: 400,
    message: "Password too weak",
    data: z.object({ reason: z.enum(["too_short", "too_long", "common", "contains_email"]) }),
  },
  PASSWORD_REUSED: { status: 400, message: "Password unchanged" },
  PASSWORD_REQUIRED: { status: 409, message: "Password required" },
  PASSWORD_ALREADY_SET: { status: 409, message: "Password already set" },
  RESET_LINK_INVALID: {
    status: 400,
    message: "Reset link invalid",
    data: z.object({ reason: z.enum(["too_many_codes"]).optional() }),
  },
  GOOGLE_SIGNIN_FAILED: { status: 400, message: "Google sign-in failed" },
  GOOGLE_UNAVAILABLE: { status: 503, message: "Google unavailable" },
  GOOGLE_EMAIL_UNVERIFIED: { status: 400, message: "Google email not verified" },
  GOOGLE_ACCOUNT_UNKNOWN: {
    status: 404,
    message: "No account for this Google account",
    data: email,
  },
  GOOGLE_ACCOUNT_IN_USE: { status: 409, message: "Google account already linked" },
  GOOGLE_OTHER_ACCOUNT_LINKED: { status: 409, message: "A different Google account is linked" },
  GOOGLE_ACCOUNT_NOT_ALLOWED: { status: 403, message: "Google account not allowed" },
  GOOGLE_ACCOUNT_MISMATCH: {
    status: 400,
    message: "Wrong Google account",
    data: z.object({ email: z.string().optional() }),
  },
  SIGNUP_TICKET_INVALID: { status: 400, message: "Sign-up ticket invalid" },
  INVITATION_INVALID: { status: 400, message: "Invitation invalid" },
  INVITATION_EXPIRED: {
    status: 410,
    message: "Invitation expired",
    data: z
      .object({ expiredAt: InstantWire })
      .extend(invitationContext)
      .partial({ inviterName: true, origin: true }),
  },
  INVITATION_REVOKED: {
    status: 410,
    message: "Invitation revoked",
    data: z.object(invitationContext),
  },
  INVITATION_USED: {
    status: 409,
    message: "Invitation already used",
    data: z.object({ recent: z.boolean() }).extend(invitationContext),
  },
  USER_CAP_REACHED: { status: 409, message: "User cap reached" },
  INVITE_ALLOWANCE_EXHAUSTED: { status: 409, message: "Invite allowance exhausted" },
  INVITATIONS_DISABLED: { status: 403, message: "Invitations disabled" },
  ALREADY_A_USER: { status: 409, message: "Already a user" },
  INVITATION_PENDING: {
    status: 409,
    message: "Invitation pending",
    data: z.object({ ownInvitationId: UuidSchema.nullable() }),
  },
  EMAIL_NOT_INVITABLE: { status: 409, message: "Email cannot be invited" },
  RESEND_LIMIT_REACHED: { status: 429, message: "Resend limit reached", data: retryAfter },
  TWO_STEP_ALREADY_ENABLED: { status: 409, message: "Two-step already enabled" },
  TWO_STEP_NOT_ENABLED: { status: 409, message: "Two-step not enabled" },
  TWO_STEP_SETUP_EXPIRED: { status: 410, message: "Two-step setup expired" },
  EXPORT_IN_PROGRESS: { status: 409, message: "Export in progress" },
  EXPORT_LIMIT_REACHED: { status: 429, message: "Export limit reached", data: retryAfter },
  EXPORT_NOT_READY: { status: 409, message: "Export not ready" },
  SOLE_ADMIN_HANDOVER_REQUIRED: {
    status: 409,
    message: "Hand over shared accounts first",
    data: z.object({
      accounts: z.array(
        z.object({ id: UuidSchema, name: z.string(), memberCount: z.number().int() }),
      ),
    }),
  },
  DELETION_ALREADY_PENDING: { status: 409, message: "Deletion already pending" },
  DELETION_NOT_PENDING: { status: 409, message: "Deletion not pending" },
  DELETION_IN_PROGRESS: { status: 409, message: "Deletion in progress" },
  OWNER_CANNOT_BE_DELETED: { status: 409, message: "The owner cannot be deleted" },
} as const;
