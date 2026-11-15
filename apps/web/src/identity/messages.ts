// F-171: identity's web message descriptors. S-0 holds the error messages (F-174); each
// slice adds the messages of its screens. The same IDs and texts are in en.json (F-9).
import { defineMessages } from "@formatjs/intl";

export const identityMessages = defineMessages({
  errorInvalidCredentials: {
    id: "error.invalidCredentials",
    defaultMessage: "Email or password is incorrect.",
  },
  errorAccountClosed: {
    id: "error.accountClosed",
    defaultMessage: "This account has been closed.",
  },
  errorGoogleAccountUnknown: {
    id: "error.googleAccountUnknown",
    defaultMessage:
      "There's no account for {email}. You need an invitation: ask someone who already has an account to invite you.",
  },
  errorGoogleEmailUnverified: {
    id: "error.googleEmailUnverified",
    defaultMessage:
      "Google hasn't confirmed this email address. Sign in with your password, or use your invitation.",
  },
  errorGoogleAccountInUse: {
    id: "error.googleAccountInUse",
    defaultMessage: "This Google account is already used by another account.",
  },
  errorGoogleOtherAccountLinked: {
    id: "error.googleOtherAccountLinked",
    defaultMessage:
      "Your account is connected to a different Google account. Use that one, or your password.",
  },
  errorGoogleAccountNotAllowed: {
    id: "error.googleAccountNotAllowed",
    defaultMessage: "This Google account can't be used here.",
  },
  errorGoogleAccountMismatch: {
    id: "error.googleAccountMismatch",
    defaultMessage: "Choose the Google account you connected ({email}).",
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
    defaultMessage: "There's no room for new people right now, so no new invitations can be sent.",
  },
  errorAlreadyAUser: {
    id: "error.alreadyAUser",
    defaultMessage: "{email} already has an account.",
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
  signinTitle: {
    id: "signin.title",
    defaultMessage: "Sign in",
  },
  signinSubmit: {
    id: "signin.submit",
    defaultMessage: "Sign in",
  },
  signinInviteOnly: {
    id: "signin.inviteOnly",
    defaultMessage: "You need an invitation to join. Got one? Open the link in the email.",
  },
  inviteChecking: {
    id: "invite.checking",
    defaultMessage: "Checking your invitation…",
  },
  inviteTitle: {
    id: "invite.title",
    defaultMessage: "You've been invited",
  },
  inviteFrom: {
    id: "invite.from",
    defaultMessage: "{inviter} invited {email} to join.",
  },
  inviteFromOwner: {
    id: "invite.fromOwner",
    defaultMessage: "Your owner invitation for {email}.",
  },
  inviteUsePassword: {
    id: "invite.usePassword",
    defaultMessage: "Use a password",
  },
  inviteExpires: {
    id: "invite.expires",
    defaultMessage: "This invitation expires on {date}.",
  },
  inviteHaveAccount: {
    id: "invite.haveAccount",
    defaultMessage: "Already have an account? Sign in",
  },
  inviteProblemTitle: {
    id: "invite.problem.title",
    defaultMessage: "This invitation can't be used",
  },
  inviteProblemExpired: {
    id: "invite.problem.expired",
    defaultMessage: "It expired on {date}.",
  },
  inviteProblemRevoked: {
    id: "invite.problem.revoked",
    defaultMessage: "It was cancelled.",
  },
  inviteProblemUsed: {
    id: "invite.problem.used",
    defaultMessage: "It has already been used. If that was you, sign in.",
  },
  inviteProblemInvalid: {
    id: "invite.problem.invalid",
    defaultMessage: "This invitation can't be used.",
  },
  inviteProblemIncomplete: {
    id: "invite.problem.incomplete",
    defaultMessage:
      "This link isn't complete. Open it again from the email, or copy the whole link.",
  },
  inviteProblemReady: {
    id: "invite.problem.ready",
    defaultMessage: "Your account is ready. Sign in to continue.",
  },
  inviteProblemAskInviter: {
    id: "invite.problem.askInviter",
    defaultMessage: "Ask {inviter} to send a new one.",
  },
  inviteFull: {
    id: "invite.full",
    defaultMessage:
      "There's no room for new people right now. {inviter} and the administrator have been told.",
  },
  setupTitle: {
    id: "setup.title",
    defaultMessage: "Set up your account",
  },
  setupName: {
    id: "setup.name",
    defaultMessage: "Your name",
  },
  setupPassword: {
    id: "setup.password",
    defaultMessage: "Password",
  },
  setupCurrency: {
    id: "setup.currency",
    defaultMessage: "Base currency",
  },
  setupTimeZone: {
    id: "setup.timeZone",
    defaultMessage: "Time zone",
  },
  setupLanguage: {
    id: "setup.language",
    defaultMessage: "Language",
  },
  setupPasswordHint: {
    id: "setup.passwordHint",
    defaultMessage: "At least 12 characters.",
  },
  setupCurrencyHint: {
    id: "setup.currencyHint",
    defaultMessage:
      "Base currency is used for totals across accounts. You can change these later in Settings.",
  },
  setupPrivacy: {
    id: "setup.privacy",
    defaultMessage: "By continuing you agree to the privacy notice.",
  },
  setupSubmit: {
    id: "setup.submit",
    defaultMessage: "Create account",
  },
  passwordTooShort: {
    id: "password.tooShort",
    defaultMessage: "Use at least 12 characters.",
  },
  passwordTooLong: {
    id: "password.tooLong",
    defaultMessage: "Use at most 128 characters.",
  },
  passwordCommon: {
    id: "password.common",
    defaultMessage: "This password is too common. Try a longer phrase.",
  },
  passwordContainsEmail: {
    id: "password.containsEmail",
    defaultMessage: "Don't include your email address in your password.",
  },
  profileNameRequired: {
    id: "profile.name.required",
    defaultMessage: "Enter your name.",
  },
  profileNameTooLong: {
    id: "profile.name.tooLong",
    defaultMessage: "Use at most 80 characters.",
  },
  profileCurrencyRequired: {
    id: "profile.currency.required",
    defaultMessage: "Choose a base currency.",
  },
  profileTimeZoneRequired: {
    id: "profile.timeZone.required",
    defaultMessage: "Choose a time zone.",
  },
  homeWelcome: {
    id: "home.welcome",
    defaultMessage: "Welcome, {name}.",
  },
  homeFirstRun: {
    id: "home.firstRun",
    defaultMessage: "Add your first account to start.",
  },
  privacyIntroTitle: {
    id: "privacy.intro.title",
    defaultMessage: "Privacy notice",
  },
  privacyIntroBody: {
    id: "privacy.intro.body",
    defaultMessage:
      "{appName} is run by one person for a small invited group. This notice says what {appName} keeps about you, why, and what you can do about it. Last updated {date}.",
  },
  privacyCollectedTitle: {
    id: "privacy.collected.title",
    defaultMessage: "What we keep",
  },
  privacyCollectedBody: {
    id: "privacy.collected.body",
    defaultMessage:
      'Your email address, your name, your language, time zone and base currency; how you sign in (a password stored only as a secure hash, and the Google account you connect, if any); whether two-step verification is on (its secret is encrypted); the devices you\'re signed in on (a label such as "Chrome on Windows", never your IP address); and a 90-day history of security events such as sign-ins and password changes. Everything you record in {appName} (accounts, transactions, budgets) is kept so the app can show it to you.',
  },
  privacyGoogleTitle: {
    id: "privacy.google.title",
    defaultMessage: "Signing in with Google",
  },
  privacyGoogleBody: {
    id: "privacy.google.body",
    defaultMessage:
      "If you sign in with Google, {appName} receives your Google account's ID, email address and name, and uses them only to sign you in. It keeps no Google access tokens for sign-in. Connecting a Gmail inbox for capture is separate and asks for its own permission.",
  },
  privacyEmailsTitle: {
    id: "privacy.emails.title",
    defaultMessage: "Emails we send",
  },
  privacyEmailsBody: {
    id: "privacy.emails.body",
    defaultMessage:
      "Only about your account: invitations, password resets, security notices and deletion notices. No newsletters or tracking.",
  },
  privacyExportTitle: {
    id: "privacy.export.title",
    defaultMessage: "Your data is yours",
  },
  privacyExportBody: {
    id: "privacy.export.body",
    defaultMessage:
      "You can download everything as CSV and JSON at any time from Settings > Your data.",
  },
  privacyDeletionTitle: {
    id: "privacy.deletion.title",
    defaultMessage: "Deleting your account",
  },
  privacyDeletionBody: {
    id: "privacy.deletion.body",
    defaultMessage:
      'You can delete your account from Settings. You have 7 days to change your mind; after that everything you own is erased. Entries you added to shared accounts stay, shown as "Deleted user". Backups that still contain your data are gone within 14 days of the erasure.',
  },
  privacyBansTitle: {
    id: "privacy.bans.title",
    defaultMessage: "If an address is banned",
  },
  privacyBansBody: {
    id: "privacy.bans.body",
    defaultMessage:
      "If the administrator bans an email address, {appName} keeps that address (and nothing else) so it can't be invited again, until the ban is lifted.",
  },
  privacyAdminTitle: {
    id: "privacy.admin.title",
    defaultMessage: "What the administrator sees",
  },
  privacyAdminBody: {
    id: "privacy.admin.body",
    defaultMessage:
      "Your name, email, account status, when you were last active and how many sources you've connected. Never your financial data.",
  },
  privacyContactTitle: {
    id: "privacy.contact.title",
    defaultMessage: "Questions",
  },
  privacyContactBody: {
    id: "privacy.contact.body",
    defaultMessage: "Contact the person who invited you, or the {appName} administrator.",
  },
  signinSessionEnded: {
    id: "signin.sessionEnded",
    defaultMessage: "Your session ended. Sign in again.",
  },
});
