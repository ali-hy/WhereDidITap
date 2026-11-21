// §6 error classes (identity LLD §6, §5.7). Extra cases TP-0.42x: each class without data, built
// with no arguments, has its key, status and fixed message, and agrees with the contract's map.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { IDENTITY_ERRORS } from "@budmon/contract";
import { describe, expect, it } from "vitest";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";
import * as E from "../../../src/identity/identityErrors.js";

const WITHOUT_DATA: [string, string][] = [
  ["InvalidCredentialsError", "INVALID_CREDENTIALS"],
  ["AccountClosedError", "ACCOUNT_CLOSED"],
  ["RefreshInvalidError", "REFRESH_INVALID"],
  ["PasswordReusedError", "PASSWORD_REUSED"],
  ["PasswordRequiredError", "PASSWORD_REQUIRED"],
  ["PasswordAlreadySetError", "PASSWORD_ALREADY_SET"],
  ["GoogleSignInFailedError", "GOOGLE_SIGNIN_FAILED"],
  ["GoogleUnavailableError", "GOOGLE_UNAVAILABLE"],
  ["GoogleEmailUnverifiedError", "GOOGLE_EMAIL_UNVERIFIED"],
  ["GoogleAccountInUseError", "GOOGLE_ACCOUNT_IN_USE"],
  ["GoogleOtherAccountLinkedError", "GOOGLE_OTHER_ACCOUNT_LINKED"],
  ["GoogleAccountNotAllowedError", "GOOGLE_ACCOUNT_NOT_ALLOWED"],
  ["SignupTicketInvalidError", "SIGNUP_TICKET_INVALID"],
  ["InvitationInvalidError", "INVITATION_INVALID"],
  ["InvitationRevokedError", "INVITATION_REVOKED"],
  ["UserCapReachedError", "USER_CAP_REACHED"],
  ["InviteAllowanceExhaustedError", "INVITE_ALLOWANCE_EXHAUSTED"],
  ["InvitationsDisabledError", "INVITATIONS_DISABLED"],
  ["AlreadyAUserError", "ALREADY_A_USER"],
  ["EmailNotInvitableError", "EMAIL_NOT_INVITABLE"],
  ["TwoStepAlreadyEnabledError", "TWO_STEP_ALREADY_ENABLED"],
  ["TwoStepNotEnabledError", "TWO_STEP_NOT_ENABLED"],
  ["TwoStepSetupExpiredError", "TWO_STEP_SETUP_EXPIRED"],
  ["ExportInProgressError", "EXPORT_IN_PROGRESS"],
  ["ExportNotReadyError", "EXPORT_NOT_READY"],
  ["DeletionAlreadyPendingError", "DELETION_ALREADY_PENDING"],
  ["DeletionNotPendingError", "DELETION_NOT_PENDING"],
  ["DeletionInProgressError", "DELETION_IN_PROGRESS"],
  ["OwnerCannotBeDeletedError", "OWNER_CANNOT_BE_DELETED"],
];

const WITH_DATA = [
  "TwoStepChallengeExpiredError", // data { reason } (A-99)
  "TwoStepCodeInvalidError",
  "ConfirmationRequiredError",
  "PasswordTooWeakError",
  "ResetLinkInvalidError",
  "GoogleAccountUnknownError",
  "GoogleAccountMismatchError",
  "InvitationExpiredError",
  "InvitationUsedError",
  "InvitationPendingError",
  "ResendLimitReachedError",
  "ExportLimitReachedError",
  "SoleAdminHandoverRequiredError",
];

const classes = E as unknown as Record<
  string,
  new () => BudmonError<Record<string, unknown> | undefined>
>;
const contractErrors = IDENTITY_ERRORS as unknown as Record<
  string,
  { status: number; message: string }
>;

describe("TP-0.42x: identity's error classes", () => {
  it.each(WITHOUT_DATA)(
    "TP-0.42x: new %s() is %s with the contract's status and message",
    (name, key) => {
      const Cls = classes[name];
      expect(Cls, `${name} is exported`).toBeTypeOf("function");
      const error = new (Cls as new () => BudmonError)();

      expect(error).toBeInstanceOf(BudmonError);
      expect(error.key).toBe(key);
      expect(error.status).toBe(contractErrors[key]?.status);
      expect(error.message).toBe(contractErrors[key]?.message);
      expect(error.name).toBe(name);
    },
  );

  it.each(WITH_DATA)("TP-0.42x: %s is exported and extends BudmonError", (name) => {
    const Cls = classes[name];
    expect(Cls).toBeTypeOf("function");
    expect(
      Object.prototype.isPrototypeOf.call(
        BudmonError.prototype,
        (Cls as { prototype: object }).prototype,
      ),
    ).toBe(true);
  });

  it("TP-0.42x: every §6 class is exported (42 classes)", () => {
    expect(WITHOUT_DATA.length + WITH_DATA.length).toBe(42);
    for (const name of [...WITHOUT_DATA.map(([n]) => n), ...WITH_DATA])
      expect(classes[name]).toBeDefined();
  });
});
