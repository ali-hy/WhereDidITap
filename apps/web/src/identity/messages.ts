// F-171: identity's web message descriptors. This slice holds the error messages (F-174); each
// later slice adds the messages of its screens. The same IDs and texts are in en.json (F-9).
import { defineMessages } from "@formatjs/intl";

export const identityMessages = defineMessages({
  errorInvalidCredentials: {
    id: "error.invalidCredentials",
    defaultMessage: "Email or password is incorrect.",
  },
  errorAccountClosed: {
    id: "error.accountClosed",
    defaultMessage: "This {appName} account has been closed.",
  },
  errorGoogleAccountUnknown: {
    id: "error.googleAccountUnknown",
    defaultMessage:
      "There's no {appName} account for {email}. {appName} is invite-only: ask someone who uses {appName} to invite you.",
  },
  errorGoogleEmailUnverified: {
    id: "error.googleEmailUnverified",
    defaultMessage:
      "Google hasn't confirmed this email address. Sign in with your password, or use your invitation.",
  },
  errorGoogleAccountInUse: {
    id: "error.googleAccountInUse",
    defaultMessage: "This Google account is already used by another {appName} account.",
  },
  errorGoogleOtherAccountLinked: {
    id: "error.googleOtherAccountLinked",
    defaultMessage:
      "Your {appName} account is connected to a different Google account. Use that one, or your password.",
  },
  errorGoogleAccountNotAllowed: {
    id: "error.googleAccountNotAllowed",
    defaultMessage: "This Google account can't be used with {appName}.",
  },
  errorGoogleAccountMismatch: {
    id: "error.googleAccountMismatch",
    defaultMessage: "Choose the Google account connected to {appName} ({email}).",
  },
  errorGoogleSigninFailed: {
    id: "error.googleSigninFailed",
    defaultMessage: "Google sign-in didn't complete. Try again.",
  },
  errorGoogleUnavailable: {
    id: "error.googleUnavailable",
    defaultMessage: "Couldn't reach Google. Try again, or use your password.",
  },
  errorInviteAllowanceExhausted: {
    id: "error.inviteAllowanceExhausted",
    defaultMessage: "You've used all your invitations. The administrator can give you more.",
  },
  errorInvitationsDisabled: {
    id: "error.invitationsDisabled",
    defaultMessage: "Sending invitations isn't available for your account.",
  },
  errorUserCapReached: {
    id: "error.userCapReached",
    defaultMessage: "{appName} is full right now, so no new invitations can be sent.",
  },
  errorAlreadyAUser: {
    id: "error.alreadyAUser",
    defaultMessage: "{email} already uses {appName}.",
  },
  errorInvitationPending: {
    id: "error.invitationPending",
    defaultMessage: "{email} already has a pending invitation.",
  },
  errorEmailNotInvitable: {
    id: "error.emailNotInvitable",
    defaultMessage: "This address can't be invited.",
  },
  errorResendLimitReached: {
    id: "error.resendLimitReached",
    defaultMessage: "You can resend this invitation again tomorrow.",
  },
  errorExportInProgress: {
    id: "error.exportInProgress",
    defaultMessage: "Preparing your export…",
  },
  errorExportLimitReached: {
    id: "error.exportLimitReached",
    defaultMessage: "You can request another export tomorrow.",
  },
  errorDeletionInProgress: {
    id: "error.deletionInProgress",
    defaultMessage: "Your account is already being deleted.",
  },
});
