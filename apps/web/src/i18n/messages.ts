// The platform's message descriptors (§8.1), with their English text as the default.
// The catalogs are i18n/messages/<locale>.json; F-9 checks they hold every ID used here.
import { defineMessages } from "@formatjs/intl";

export const messages = defineMessages({
  appDocumentTitle: { id: "app.documentTitle", defaultMessage: "{page} – {appName}" },
  errorFallbackBody: {
    id: "error.fallback.body",
    defaultMessage:
      "Try again in a moment. If it keeps happening, share this reference with the person who invited you.",
  },
  errorFallbackBodyNoReference: {
    id: "error.fallback.bodyNoReference",
    defaultMessage:
      "Try again in a moment. If it keeps happening, let the person who invited you know.",
  },
  errorFallbackHome: { id: "error.fallback.home", defaultMessage: "Go to home" },
  errorFallbackRetry: { id: "error.fallback.retry", defaultMessage: "Try again" },
  errorFallbackStillFailing: {
    id: "error.fallback.stillFailing",
    defaultMessage: "Still not working.",
  },
  errorFallbackTitle: {
    id: "error.fallback.title",
    defaultMessage: "Something went wrong on our side",
  },
  errorForbidden: {
    id: "error.forbidden",
    defaultMessage: "You don't have permission to do this.",
  },
  errorGenericNotChanged: {
    id: "error.generic.notChanged",
    defaultMessage: "Something went wrong on our side. Nothing was changed. Try again in a moment.",
  },
  errorGenericRead: {
    id: "error.generic.read",
    defaultMessage: "Something went wrong on our side. Try again in a moment.",
  },
  errorGenericUnknownOutcome: {
    id: "error.generic.unknownOutcome",
    defaultMessage: "We couldn't confirm this was saved. Check before trying again.",
  },
  errorNotFound: {
    id: "error.notFound",
    defaultMessage: "This item doesn't exist or you no longer have access to it.",
  },
  errorNotFoundTitle: { id: "error.notFound.title", defaultMessage: "Page not found" },
  errorRateLimited: {
    id: "error.rateLimited",
    defaultMessage:
      "{minutes, plural, one {Too many attempts. Try again in # minute.} other {Too many attempts. Try again in # minutes.}}",
  },
  errorReference: { id: "error.reference", defaultMessage: "Reference: {ref}" },
  errorUnavailable: {
    id: "error.unavailable",
    defaultMessage: "{appName} is temporarily unavailable. Try again in a few minutes.",
  },
  errorValidationForm: { id: "error.validation.form", defaultMessage: "Some details need fixing." },
  errorValidationUnknownField: {
    id: "error.validation.unknownField",
    defaultMessage: "Something in this form isn't valid: {label}",
  },
  homePlaceholder: { id: "home.placeholder", defaultMessage: "Nothing here yet." },
  offlineBack: { id: "offline.back", defaultMessage: "Back online." },
  offlineBannerWeb: { id: "offline.banner.web", defaultMessage: "You're offline." },
  tableEmpty: { id: "table.empty", defaultMessage: "Nothing to show yet." },
  updateRequiredWeb: {
    id: "update.required.web",
    defaultMessage: "This version of {appName} is out of date. Reload to continue.",
  },
  updateWebAvailable: {
    id: "update.web.available",
    defaultMessage: "{appName} has been updated. Reload to get the latest version.",
  },
  updateWebReload: { id: "update.web.reload", defaultMessage: "Reload" },
  validationInvalid: { id: "validation.invalid", defaultMessage: "Enter a valid value." },
  validationInvalidFormat: { id: "validation.invalid_format", defaultMessage: "Check the format." },
  validationInvalidType: { id: "validation.invalid_type", defaultMessage: "Enter a valid value." },
  validationTooBig: { id: "validation.too_big", defaultMessage: "This is too long or too large." },
  validationTooSmall: {
    id: "validation.too_small",
    defaultMessage: "This is too short or too small.",
  },
  validationUnrecognizedKeys: {
    id: "validation.unrecognized_keys",
    defaultMessage: "Remove the unexpected field.",
  },
});
