// Identity's contract (identity LLD F-35, §5.1, §6). TP-0.25 with S-1's expectations, plus
// extra cases TP-0.25x (the shared schemas) and TP-0.42x (the error map).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_MINOR,
  CodeInput,
  DeviceFields,
  EmailInput,
  GoogleResult,
  IDENTITY_ERRORS,
  MeSchema,
  PasswordInput,
  ProfilePatch,
  RecoveryCodeInput,
  ReturnTo,
  SessionTokens,
  SignInResult,
  TokenDelivery,
  TokenInput,
  contract,
} from "../src/index.js";
import { checkContractRules } from "../src/rules/contractRules.js";
import { emitOpenapi } from "../scripts/emitOpenapi.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;
const WIRE = "2026-11-02T10:00:00.000Z";
const UUID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a50";

describe("TP-0.25: the contract with identity's S-0 part", () => {
  it("TP-0.25: checkContractRules on the generated document finds no violations", async () => {
    const document = JSON.parse(await emitOpenapi()) as Parameters<typeof checkContractRules>[0];

    expect(checkContractRules(document)).toEqual([]);
  });

  it("TP-0.25: the generated document equals the committed openapi.json", async () => {
    expect(await emitOpenapi()).toBe(readFileSync(path.join(PACKAGE_DIR, "openapi.json"), "utf8"));
  });

  it("TP-0.25 (S-1): the document has S-1's procedures (auth, me, invitations) and API_MINOR went from 0 to 1", async () => {
    const document = JSON.parse(await emitOpenapi()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      info: { version: string };
    };
    const operations = Object.entries(document.paths)
      .flatMap(([route, methods]) =>
        Object.entries(methods).map(
          ([method, op]) => `${method.toUpperCase()} ${route} ${String(op.operationId)}`,
        ),
      )
      .sort();

    expect(Object.keys(contract).sort()).toEqual(["auth", "invitations", "me", "meta"]);
    expect(operations).toEqual(
      [
        "GET /meta/client-config meta.clientConfig",
        "GET /auth/sign-up-options auth.signUpOptions",
        "GET /me me.get",
        "POST /invitations/preview invitations.preview",
        "POST /invitations/accept invitations.accept",
      ].sort(),
    );
    expect(API_MINOR).toBe(1);
    expect(document.info.version).toBe("1.1");
  });
});

describe("TP-0.25x: §5.1's shared schemas", () => {
  it("TP-0.25x: EmailInput is 1..320 characters", () => {
    expect(ok(EmailInput, "a")).toBe(true);
    expect(ok(EmailInput, "a".repeat(320))).toBe(true);
    expect(ok(EmailInput, "")).toBe(false);
    expect(ok(EmailInput, "a".repeat(321))).toBe(false);
  });

  it("TP-0.25x: PasswordInput is 1..1024, TokenInput 1..128", () => {
    expect(ok(PasswordInput, "a".repeat(1024))).toBe(true);
    expect(ok(PasswordInput, "a".repeat(1025))).toBe(false);
    expect(ok(PasswordInput, "")).toBe(false);
    expect(ok(TokenInput, "a".repeat(128))).toBe(true);
    expect(ok(TokenInput, "a".repeat(129))).toBe(false);
    expect(ok(TokenInput, "")).toBe(false);
  });

  it("TP-0.25x: CodeInput is 6..16, RecoveryCodeInput 12..32", () => {
    expect(ok(CodeInput, "123 456")).toBe(true);
    expect(ok(CodeInput, "12345")).toBe(false);
    expect(ok(CodeInput, "1".repeat(17))).toBe(false);
    expect(ok(RecoveryCodeInput, "ABCD-EFGH-IJ")).toBe(true);
    expect(ok(RecoveryCodeInput, "A".repeat(11))).toBe(false);
    expect(ok(RecoveryCodeInput, "A".repeat(33))).toBe(false);
  });

  it("TP-0.25x: TokenDelivery is cookie or body; DeviceFields are optional and bounded", () => {
    expect(TokenDelivery.options).toEqual(["cookie", "body"]);
    expect(ok(DeviceFields.deviceModel, undefined)).toBe(true);
    expect(ok(DeviceFields.deviceModel, "x".repeat(100))).toBe(true);
    expect(ok(DeviceFields.deviceModel, "x".repeat(101))).toBe(false);
    expect(ok(DeviceFields.deviceToken, "x".repeat(128))).toBe(true);
    expect(ok(DeviceFields.deviceToken, "x".repeat(129))).toBe(false);
  });

  it.each([
    ["/", true],
    ["/settings/security", true],
    ["/a_b-c/9", true],
    [`/${"a".repeat(200)}`, true],
    [`/${"a".repeat(201)}`, false],
    ["//evil.com", false],
    ["https://x", false],
    ["/a?b", false],
    ["/a#b", false],
    ["", false],
    ["settings", false],
  ])("TP-0.25x: ReturnTo %j → %s", (value, expected) => {
    expect(ok(ReturnTo, value)).toBe(expected);
  });

  it("TP-0.25x: SessionTokens and SignInResult's two shapes", () => {
    const tokens = {
      accessToken: "a",
      refreshToken: "r",
      accessExpiresAt: WIRE,
      refreshExpiresAt: WIRE,
      deviceToken: null,
    };
    expect(ok(SessionTokens, tokens)).toBe(true);
    expect(ok(SessionTokens, { ...tokens, accessExpiresAt: "2026-11-02T10:00:00Z" })).toBe(false);
    expect(ok(SignInResult, { status: "signed_in", tokens: null, recoveryCodesLeft: null })).toBe(
      true,
    );
    expect(ok(SignInResult, { status: "signed_in", tokens, recoveryCodesLeft: 3 })).toBe(true);
    expect(ok(SignInResult, { status: "signed_in", tokens, recoveryCodesLeft: 1.5 })).toBe(false);
    expect(
      ok(SignInResult, { status: "two_step_required", challengeToken: null, expiresAt: WIRE }),
    ).toBe(true);
    expect(ok(SignInResult, { status: "unknown" })).toBe(false);
  });

  it("TP-0.25x: GoogleResult's five shapes each carry returnTo", () => {
    const returnTo = "/";
    expect(
      ok(GoogleResult, { status: "signed_in", tokens: null, recoveryCodesLeft: null, returnTo }),
    ).toBe(true);
    expect(
      ok(GoogleResult, {
        status: "two_step_required",
        challengeToken: null,
        expiresAt: WIRE,
        returnTo,
      }),
    ).toBe(true);
    expect(
      ok(GoogleResult, {
        status: "sign_up",
        signUpTicket: "t",
        googleEmail: "e",
        suggestedName: null,
        returnTo,
      }),
    ).toBe(true);
    expect(ok(GoogleResult, { status: "linked", returnTo })).toBe(true);
    expect(ok(GoogleResult, { status: "confirmed", confirmedUntil: WIRE, returnTo })).toBe(true);
    expect(ok(GoogleResult, { status: "linked" })).toBe(false);
  });

  it("TP-0.25x: MeSchema accepts a full profile and refuses a bad currency or status", () => {
    const me = {
      id: UUID,
      email: "mona@example.com",
      displayName: "Mona",
      locale: "en",
      timeZone: "Africa/Cairo",
      baseCurrency: "EGP",
      status: "active",
      deletionScheduledFor: null,
      isOwner: false,
      hasPassword: true,
      passwordUpdatedAt: WIRE,
      google: null,
      twoStep: { enabled: false, recoveryCodesLeft: 0, codesAcknowledged: false },
      confirmedUntil: null,
      sessionId: UUID,
    };
    expect(ok(MeSchema, me)).toBe(true);
    expect(ok(MeSchema, { ...me, baseCurrency: "EG" })).toBe(false);
    expect(ok(MeSchema, { ...me, status: "deleted" })).toBe(false);
  });

  it("TP-0.25x: ProfilePatch fields are optional and bounded", () => {
    expect(ok(ProfilePatch, {})).toBe(true);
    expect(ok(ProfilePatch, { displayName: "x".repeat(200) })).toBe(true);
    expect(ok(ProfilePatch, { displayName: "x".repeat(201) })).toBe(false);
    expect(ok(ProfilePatch, { locale: "x".repeat(36) })).toBe(false);
    expect(ok(ProfilePatch, { timeZone: "x".repeat(65) })).toBe(false);
    expect(ok(ProfilePatch, { baseCurrency: "USDX" })).toBe(false);
  });
});

/** §6's catalog: key → [status, message, an example `data` or undefined]. */
const CATALOG: [string, number, string, unknown][] = [
  ["INVALID_CREDENTIALS", 401, "Invalid credentials", undefined],
  ["ACCOUNT_CLOSED", 403, "Account closed", undefined],
  ["TWO_STEP_CHALLENGE_EXPIRED", 401, "Two-step challenge expired", undefined],
  ["TWO_STEP_CODE_INVALID", 400, "Invalid two-step code", { attemptsLeft: 2 }],
  ["REFRESH_INVALID", 401, "Refresh token invalid", undefined],
  ["CONFIRMATION_REQUIRED", 403, "Confirmation required", { factor: "password" }],
  ["PASSWORD_TOO_WEAK", 400, "Password too weak", { reason: "too_short" }],
  ["PASSWORD_REUSED", 400, "Password unchanged", undefined],
  ["PASSWORD_REQUIRED", 409, "Password required", undefined],
  ["PASSWORD_ALREADY_SET", 409, "Password already set", undefined],
  ["RESET_LINK_INVALID", 400, "Reset link invalid", { reason: "too_many_codes" }],
  ["GOOGLE_SIGNIN_FAILED", 400, "Google sign-in failed", undefined],
  ["GOOGLE_UNAVAILABLE", 503, "Google unavailable", undefined],
  ["GOOGLE_EMAIL_UNVERIFIED", 400, "Google email not verified", undefined],
  [
    "GOOGLE_ACCOUNT_UNKNOWN",
    404,
    "No account for this Google account",
    { email: "mona@example.com" },
  ],
  ["GOOGLE_ACCOUNT_IN_USE", 409, "Google account already linked", undefined],
  ["GOOGLE_OTHER_ACCOUNT_LINKED", 409, "A different Google account is linked", undefined],
  ["GOOGLE_ACCOUNT_NOT_ALLOWED", 403, "Google account not allowed", undefined],
  ["GOOGLE_ACCOUNT_MISMATCH", 400, "Wrong Google account", { email: "mona@example.com" }],
  ["SIGNUP_TICKET_INVALID", 400, "Sign-up ticket invalid", undefined],
  ["INVITATION_INVALID", 400, "Invitation invalid", undefined],
  ["INVITATION_EXPIRED", 410, "Invitation expired", { expiredAt: WIRE }],
  ["INVITATION_REVOKED", 410, "Invitation revoked", undefined],
  ["INVITATION_USED", 409, "Invitation already used", { recent: true }],
  ["USER_CAP_REACHED", 409, "User cap reached", undefined],
  ["INVITE_ALLOWANCE_EXHAUSTED", 409, "Invite allowance exhausted", undefined],
  ["INVITATIONS_DISABLED", 403, "Invitations disabled", undefined],
  ["ALREADY_A_USER", 409, "Already a user", undefined],
  ["INVITATION_PENDING", 409, "Invitation pending", { ownInvitationId: null }],
  ["EMAIL_NOT_INVITABLE", 409, "Email cannot be invited", undefined],
  ["RESEND_LIMIT_REACHED", 429, "Resend limit reached", { retryAfterSeconds: 60 }],
  ["TWO_STEP_ALREADY_ENABLED", 409, "Two-step already enabled", undefined],
  ["TWO_STEP_NOT_ENABLED", 409, "Two-step not enabled", undefined],
  ["TWO_STEP_SETUP_EXPIRED", 410, "Two-step setup expired", undefined],
  ["EXPORT_IN_PROGRESS", 409, "Export in progress", undefined],
  ["EXPORT_LIMIT_REACHED", 429, "Export limit reached", { retryAfterSeconds: 60 }],
  ["EXPORT_NOT_READY", 409, "Export not ready", undefined],
  [
    "SOLE_ADMIN_HANDOVER_REQUIRED",
    409,
    "Hand over shared accounts first",
    { accounts: [{ id: UUID, name: "Family", memberCount: 2 }] },
  ],
  ["DELETION_ALREADY_PENDING", 409, "Deletion already pending", undefined],
  ["DELETION_NOT_PENDING", 409, "Deletion not pending", undefined],
  ["DELETION_IN_PROGRESS", 409, "Deletion in progress", undefined],
  ["OWNER_CANNOT_BE_DELETED", 409, "The owner cannot be deleted", undefined],
];

type ErrorEntry = {
  status: number;
  message: string;
  data?: { safeParse(v: unknown): { success: boolean } };
};
const errors = IDENTITY_ERRORS as unknown as Record<string, ErrorEntry>;

describe("TP-0.42x: IDENTITY_ERRORS is §6's catalog", () => {
  it("TP-0.42x: exactly §6's keys", () => {
    expect(Object.keys(errors).sort()).toEqual(CATALOG.map(([k]) => k).sort());
  });

  it.each(CATALOG)("TP-0.42x: %s is %d with message %j", (key, status, message, data) => {
    const entry = errors[key];
    expect(entry?.status).toBe(status);
    expect(entry?.message).toBe(message);
    if (data !== undefined) {
      expect(entry?.data, `${key} declares a data schema`).toBeDefined();
      expect(entry?.data?.safeParse(data).success).toBe(true);
    }
  });

  it("TP-0.42x: CONFIRMATION_REQUIRED's factor is two_step, password or google only", () => {
    const data = errors["CONFIRMATION_REQUIRED"]?.data;
    for (const factor of ["two_step", "password", "google"])
      expect(data?.safeParse({ factor }).success).toBe(true);
    expect(data?.safeParse({ factor: "sms" }).success).toBe(false);
  });
});
