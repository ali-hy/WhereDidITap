// F-174 identityErrorMessage and F-171's error IDs (identity LLD §4.14, §8.1, LD-12). TP-0.38, plus
// extra cases TP-0.38x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../src/api/errors.js";
import { messageForError } from "../../src/api/errorMessages.js";
import { identityErrorMessage } from "../../src/identity/errorMessages.js";
import { identityMessages } from "../../src/identity/messages.js";

const EN = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/i18n/messages/en.json"),
    "utf8",
  ),
) as Record<string, string>;

const defined = (key: string, status: number, data?: unknown): AppError => ({
  kind: "defined",
  key,
  status,
  data,
});

describe("TP-0.38: identityErrorMessage", () => {
  it("TP-0.38: defined INVALID_CREDENTIALS → error.invalidCredentials", () => {
    const m = identityErrorMessage(defined("INVALID_CREDENTIALS", 401), "mutation");

    expect(m.descriptor.id).toBe("error.invalidCredentials");
  });

  it("TP-0.38: defined GOOGLE_ACCOUNT_UNKNOWN with data.email → error.googleAccountUnknown with { email }", () => {
    const m = identityErrorMessage(
      defined("GOOGLE_ACCOUNT_UNKNOWN", 404, { email: "mona@example.com" }),
      "mutation",
    );

    expect(m.descriptor.id).toBe("error.googleAccountUnknown");
    expect(m.values).toEqual({ email: "mona@example.com" });
  });

  it("TP-0.38: defined RATE_LIMITED with retryAfterSeconds 90 → P-F-203's error.rateLimited with { minutes: 2 }", () => {
    const m = identityErrorMessage(
      defined("RATE_LIMITED", 429, { retryAfterSeconds: 90 }),
      "mutation",
    );

    expect(m.descriptor.id).toBe("error.rateLimited");
    expect(m.values).toEqual({ minutes: 2 });
  });

  it("TP-0.38: network → error.unavailable", () => {
    expect(identityErrorMessage({ kind: "network" }, "read").descriptor.id).toBe(
      "error.unavailable",
    );
  });

  it("TP-0.38: defined SOMETHING_ELSE on a read → error.generic.read", () => {
    expect(identityErrorMessage(defined("SOMETHING_ELSE", 409), "read").descriptor.id).toBe(
      "error.generic.read",
    );
  });
});

/** §8.1's identity error IDs and their English text. */
const IDENTITY_ERROR_TEXT: [string, string, string][] = [
  ["INVALID_CREDENTIALS", "error.invalidCredentials", "Email or password is incorrect."],
  ["ACCOUNT_CLOSED", "error.accountClosed", "This {appName} account has been closed."],
  [
    "GOOGLE_ACCOUNT_UNKNOWN",
    "error.googleAccountUnknown",
    "There's no {appName} account for {email}. {appName} is invite-only: ask someone who uses {appName} to invite you.",
  ],
  [
    "GOOGLE_EMAIL_UNVERIFIED",
    "error.googleEmailUnverified",
    "Google hasn't confirmed this email address. Sign in with your password, or use your invitation.",
  ],
  [
    "GOOGLE_ACCOUNT_IN_USE",
    "error.googleAccountInUse",
    "This Google account is already used by another {appName} account.",
  ],
  [
    "GOOGLE_OTHER_ACCOUNT_LINKED",
    "error.googleOtherAccountLinked",
    "Your {appName} account is connected to a different Google account. Use that one, or your password.",
  ],
  [
    "GOOGLE_ACCOUNT_NOT_ALLOWED",
    "error.googleAccountNotAllowed",
    "This Google account can't be used with {appName}.",
  ],
  [
    "GOOGLE_ACCOUNT_MISMATCH",
    "error.googleAccountMismatch",
    "Choose the Google account connected to {appName} ({email}).",
  ],
  [
    "GOOGLE_SIGNIN_FAILED",
    "error.googleSigninFailed",
    "Google sign-in didn't complete. Try again.",
  ],
  [
    "GOOGLE_UNAVAILABLE",
    "error.googleUnavailable",
    "Couldn't reach Google. Try again, or use your password.",
  ],
  [
    "INVITE_ALLOWANCE_EXHAUSTED",
    "error.inviteAllowanceExhausted",
    "You've used all your invitations. The administrator can give you more.",
  ],
  [
    "INVITATIONS_DISABLED",
    "error.invitationsDisabled",
    "Sending invitations isn't available for your account.",
  ],
  [
    "USER_CAP_REACHED",
    "error.userCapReached",
    "{appName} is full right now, so no new invitations can be sent.",
  ],
  ["ALREADY_A_USER", "error.alreadyAUser", "{email} already uses {appName}."],
  ["INVITATION_PENDING", "error.invitationPending", "{email} already has a pending invitation."],
  ["EMAIL_NOT_INVITABLE", "error.emailNotInvitable", "This address can't be invited."],
  [
    "RESEND_LIMIT_REACHED",
    "error.resendLimitReached",
    "You can resend this invitation again tomorrow.",
  ],
  ["EXPORT_IN_PROGRESS", "error.exportInProgress", "Preparing your export…"],
  ["EXPORT_LIMIT_REACHED", "error.exportLimitReached", "You can request another export tomorrow."],
  ["DELETION_IN_PROGRESS", "error.deletionInProgress", "Your account is already being deleted."],
];

describe("TP-0.38x: identity keys and the platform fallback", () => {
  it.each(IDENTITY_ERROR_TEXT)("TP-0.38x: defined %s → %s", (key, id) => {
    expect(identityErrorMessage(defined(key, 409), "mutation").descriptor.id).toBe(id);
  });

  it.each(IDENTITY_ERROR_TEXT)(
    "TP-0.38x: %s's ID %s is in en.json with §8.1's text",
    (_key, id, text) => {
      expect(EN[id]).toBe(text);
    },
  );

  it("TP-0.38x: identityMessages holds each error descriptor with its English defaultMessage", () => {
    const byId = new Map(
      Object.values(
        identityMessages as Record<string, { id: string; defaultMessage?: unknown }>,
      ).map((d) => [d.id, d]),
    );
    for (const [, id, text] of IDENTITY_ERROR_TEXT) expect(byId.get(id)?.defaultMessage).toBe(text);
  });

  it("TP-0.38x: GOOGLE_ACCOUNT_MISMATCH with data.email gives { email }", () => {
    const m = identityErrorMessage(
      defined("GOOGLE_ACCOUNT_MISMATCH", 400, { email: "a@b.co" }),
      "mutation",
    );

    expect(m).toEqual({
      descriptor: expect.objectContaining({ id: "error.googleAccountMismatch" }),
      values: { email: "a@b.co" },
    });
  });

  it.each<[string, AppError, "read" | "create" | "mutation"]>([
    ["timeout on a read", { kind: "timeout" }, "read"],
    ["unavailable", { kind: "unavailable" }, "mutation"],
    ["unknown on a create", { kind: "unknown" }, "create"],
    [
      "INTERNAL not_applied on a mutation",
      defined("INTERNAL", 500, { outcome: "not_applied" }),
      "mutation",
    ],
    ["NOT_FOUND", defined("NOT_FOUND", 404), "read"],
    ["VALIDATION_FAILED", defined("VALIDATION_FAILED", 400, { issues: [] }), "mutation"],
    [
      "an identity key without its own message (REFRESH_INVALID)",
      defined("REFRESH_INVALID", 401),
      "read",
    ],
    [
      "an identity key without its own message (PASSWORD_TOO_WEAK)",
      defined("PASSWORD_TOO_WEAK", 400, { reason: "common" }),
      "mutation",
    ],
  ])("TP-0.38x: %s → exactly P-F-203's message", (_label, e, op) => {
    expect(identityErrorMessage(e, op)).toEqual(messageForError(e, op));
  });
});
