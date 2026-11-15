// §6: identity's error classes. Keys, statuses and fixed messages match the contract's IDENTITY_ERRORS.
import { BudmonError } from "../platform/errors/BudmonError.js";

export type ConfirmationFactor = "two_step" | "password" | "google";
export type PasswordProblemReason = "too_short" | "too_long" | "common" | "contains_email";

export class InvalidCredentialsError extends BudmonError {
  constructor() {
    super("INVALID_CREDENTIALS", 401, "Invalid credentials");
  }
}

export class AccountClosedError extends BudmonError {
  constructor() {
    super("ACCOUNT_CLOSED", 403, "Account closed");
  }
}

export class TwoStepChallengeExpiredError extends BudmonError {
  constructor() {
    super("TWO_STEP_CHALLENGE_EXPIRED", 401, "Two-step challenge expired");
  }
}

export class TwoStepCodeInvalidError extends BudmonError<{ attemptsLeft?: number }> {
  constructor(attemptsLeft?: number) {
    super(
      "TWO_STEP_CODE_INVALID",
      400,
      "Invalid two-step code",
      attemptsLeft === undefined ? {} : { attemptsLeft },
    );
  }
}

export class RefreshInvalidError extends BudmonError {
  constructor() {
    super("REFRESH_INVALID", 401, "Refresh token invalid");
  }
}

export class ConfirmationRequiredError extends BudmonError<{ factor: ConfirmationFactor }> {
  constructor(factor: ConfirmationFactor) {
    super("CONFIRMATION_REQUIRED", 403, "Confirmation required", { factor });
  }
}

export class PasswordTooWeakError extends BudmonError<{ reason: PasswordProblemReason }> {
  constructor(reason: PasswordProblemReason) {
    super("PASSWORD_TOO_WEAK", 400, "Password too weak", { reason });
  }
}

export class PasswordReusedError extends BudmonError {
  constructor() {
    super("PASSWORD_REUSED", 400, "Password unchanged");
  }
}

export class PasswordRequiredError extends BudmonError {
  constructor() {
    super("PASSWORD_REQUIRED", 409, "Password required");
  }
}

export class PasswordAlreadySetError extends BudmonError {
  constructor() {
    super("PASSWORD_ALREADY_SET", 409, "Password already set");
  }
}

export class ResetLinkInvalidError extends BudmonError<{ reason?: "too_many_codes" }> {
  constructor(reason?: "too_many_codes") {
    super("RESET_LINK_INVALID", 400, "Reset link invalid", reason === undefined ? {} : { reason });
  }
}

export class GoogleSignInFailedError extends BudmonError {
  constructor() {
    super("GOOGLE_SIGNIN_FAILED", 400, "Google sign-in failed");
  }
}

export class GoogleUnavailableError extends BudmonError {
  constructor() {
    super("GOOGLE_UNAVAILABLE", 503, "Google unavailable");
  }
}

export class GoogleEmailUnverifiedError extends BudmonError {
  constructor() {
    super("GOOGLE_EMAIL_UNVERIFIED", 400, "Google email not verified");
  }
}

export class GoogleAccountUnknownError extends BudmonError<{ email: string }> {
  constructor(email: string) {
    super("GOOGLE_ACCOUNT_UNKNOWN", 404, "No account for this Google account", { email });
  }
}

export class GoogleAccountInUseError extends BudmonError {
  constructor() {
    super("GOOGLE_ACCOUNT_IN_USE", 409, "Google account already linked");
  }
}

export class GoogleOtherAccountLinkedError extends BudmonError {
  constructor() {
    super("GOOGLE_OTHER_ACCOUNT_LINKED", 409, "A different Google account is linked");
  }
}

export class GoogleAccountNotAllowedError extends BudmonError {
  constructor() {
    super("GOOGLE_ACCOUNT_NOT_ALLOWED", 403, "Google account not allowed");
  }
}

export class GoogleAccountMismatchError extends BudmonError<{ email?: string }> {
  constructor(email?: string) {
    super(
      "GOOGLE_ACCOUNT_MISMATCH",
      400,
      "Wrong Google account",
      email === undefined ? {} : { email },
    );
  }
}

export class SignupTicketInvalidError extends BudmonError {
  constructor() {
    super("SIGNUP_TICKET_INVALID", 400, "Sign-up ticket invalid");
  }
}

export class InvitationInvalidError extends BudmonError {
  constructor() {
    super("INVITATION_INVALID", 400, "Invitation invalid");
  }
}

/** Who the invitation came from, so the page can say whom to ask (A-58). */
export type InvitationContext = {
  inviterName: string | null;
  origin: "direct" | "account_share" | "bootstrap";
};

/** `expiredAt` is an InstantWire string. */
export class InvitationExpiredError extends BudmonError<{ expiredAt: string } & InvitationContext> {
  constructor(expiredAt: string, context: InvitationContext) {
    super("INVITATION_EXPIRED", 410, "Invitation expired", { expiredAt, ...context });
  }
}

export class InvitationRevokedError extends BudmonError<InvitationContext> {
  constructor(context: InvitationContext) {
    super("INVITATION_REVOKED", 410, "Invitation revoked", { ...context });
  }
}

export class InvitationUsedError extends BudmonError<{ recent: boolean } & InvitationContext> {
  constructor(recent: boolean, context: InvitationContext) {
    super("INVITATION_USED", 409, "Invitation already used", { recent, ...context });
  }
}

export class UserCapReachedError extends BudmonError {
  constructor() {
    super("USER_CAP_REACHED", 409, "User cap reached");
  }
}

export class InviteAllowanceExhaustedError extends BudmonError {
  constructor() {
    super("INVITE_ALLOWANCE_EXHAUSTED", 409, "Invite allowance exhausted");
  }
}

export class InvitationsDisabledError extends BudmonError {
  constructor() {
    super("INVITATIONS_DISABLED", 403, "Invitations disabled");
  }
}

export class AlreadyAUserError extends BudmonError {
  constructor() {
    super("ALREADY_A_USER", 409, "Already a user");
  }
}

export class InvitationPendingError extends BudmonError<{ ownInvitationId: string | null }> {
  constructor(ownInvitationId: string | null) {
    super("INVITATION_PENDING", 409, "Invitation pending", { ownInvitationId });
  }
}

export class EmailNotInvitableError extends BudmonError {
  constructor() {
    super("EMAIL_NOT_INVITABLE", 409, "Email cannot be invited");
  }
}

export class ResendLimitReachedError extends BudmonError<{ retryAfterSeconds: number }> {
  constructor(retryAfterSeconds: number) {
    super("RESEND_LIMIT_REACHED", 429, "Resend limit reached", { retryAfterSeconds });
  }
}

export class TwoStepAlreadyEnabledError extends BudmonError {
  constructor() {
    super("TWO_STEP_ALREADY_ENABLED", 409, "Two-step already enabled");
  }
}

export class TwoStepNotEnabledError extends BudmonError {
  constructor() {
    super("TWO_STEP_NOT_ENABLED", 409, "Two-step not enabled");
  }
}

export class TwoStepSetupExpiredError extends BudmonError {
  constructor() {
    super("TWO_STEP_SETUP_EXPIRED", 410, "Two-step setup expired");
  }
}

export class ExportInProgressError extends BudmonError {
  constructor() {
    super("EXPORT_IN_PROGRESS", 409, "Export in progress");
  }
}

export class ExportLimitReachedError extends BudmonError<{ retryAfterSeconds: number }> {
  constructor(retryAfterSeconds: number) {
    super("EXPORT_LIMIT_REACHED", 429, "Export limit reached", { retryAfterSeconds });
  }
}

export class ExportNotReadyError extends BudmonError {
  constructor() {
    super("EXPORT_NOT_READY", 409, "Export not ready");
  }
}

export interface HandoverAccount {
  id: string;
  name: string;
  memberCount: number;
}

export class SoleAdminHandoverRequiredError extends BudmonError<{
  accounts: readonly HandoverAccount[];
}> {
  constructor(accounts: readonly HandoverAccount[]) {
    super("SOLE_ADMIN_HANDOVER_REQUIRED", 409, "Hand over shared accounts first", { accounts });
  }
}

export class DeletionAlreadyPendingError extends BudmonError {
  constructor() {
    super("DELETION_ALREADY_PENDING", 409, "Deletion already pending");
  }
}

export class DeletionNotPendingError extends BudmonError {
  constructor() {
    super("DELETION_NOT_PENDING", 409, "Deletion not pending");
  }
}

export class DeletionInProgressError extends BudmonError {
  constructor() {
    super("DELETION_IN_PROGRESS", 409, "Deletion in progress");
  }
}

export class OwnerCannotBeDeletedError extends BudmonError {
  constructor() {
    super("OWNER_CANNOT_BE_DELETED", 409, "The owner cannot be deleted");
  }
}
