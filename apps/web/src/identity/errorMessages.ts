// F-174: the message for an identity failure; everything else keeps the platform's wording.
import type { AppError } from "../api/errors.js";
import { messageForError, type ErrorMessage, type Operation } from "../api/errorMessages.js";
import { identityMessages } from "./messages.js";

const BY_KEY: Readonly<Record<string, ErrorMessage["descriptor"]>> = {
  INVALID_CREDENTIALS: identityMessages.errorInvalidCredentials,
  ACCOUNT_CLOSED: identityMessages.errorAccountClosed,
  GOOGLE_ACCOUNT_UNKNOWN: identityMessages.errorGoogleAccountUnknown,
  GOOGLE_EMAIL_UNVERIFIED: identityMessages.errorGoogleEmailUnverified,
  GOOGLE_ACCOUNT_IN_USE: identityMessages.errorGoogleAccountInUse,
  GOOGLE_OTHER_ACCOUNT_LINKED: identityMessages.errorGoogleOtherAccountLinked,
  GOOGLE_ACCOUNT_NOT_ALLOWED: identityMessages.errorGoogleAccountNotAllowed,
  GOOGLE_ACCOUNT_MISMATCH: identityMessages.errorGoogleAccountMismatch,
  GOOGLE_SIGNIN_FAILED: identityMessages.errorGoogleSigninFailed,
  GOOGLE_UNAVAILABLE: identityMessages.errorGoogleUnavailable,
  INVITE_ALLOWANCE_EXHAUSTED: identityMessages.errorInviteAllowanceExhausted,
  INVITATIONS_DISABLED: identityMessages.errorInvitationsDisabled,
  USER_CAP_REACHED: identityMessages.errorUserCapReached,
  ALREADY_A_USER: identityMessages.errorAlreadyAUser,
  INVITATION_PENDING: identityMessages.errorInvitationPending,
  EMAIL_NOT_INVITABLE: identityMessages.errorEmailNotInvitable,
  RESEND_LIMIT_REACHED: identityMessages.errorResendLimitReached,
  EXPORT_IN_PROGRESS: identityMessages.errorExportInProgress,
  EXPORT_LIMIT_REACHED: identityMessages.errorExportLimitReached,
  DELETION_IN_PROGRESS: identityMessages.errorDeletionInProgress,
};

/** The `email` the server sent in an error's data, when it's a string. */
function emailOf(data: unknown): string | undefined {
  const email =
    typeof data === "object" && data !== null ? (data as { email?: unknown }).email : undefined;
  return typeof email === "string" ? email : undefined;
}

export function identityErrorMessage(e: AppError, operation: Operation): ErrorMessage {
  if (e.kind === "defined") {
    const descriptor = Object.hasOwn(BY_KEY, e.key) ? BY_KEY[e.key] : undefined;
    if (descriptor !== undefined) {
      const email =
        e.key === "GOOGLE_ACCOUNT_UNKNOWN" || e.key === "GOOGLE_ACCOUNT_MISMATCH"
          ? emailOf(e.data)
          : undefined;
      return email === undefined ? { descriptor } : { descriptor, values: { email } };
    }
  }
  return messageForError(e, operation);
}
