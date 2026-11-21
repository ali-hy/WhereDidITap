// F-35, §5: identity's procedures. Each slice adds its own; S-1 has sign-up, `me.get` and the
// sign-up options.
import { z } from "zod";
import { base } from "../common/errors.js";
import { InstantWire } from "../common/dates.js";
import { UuidSchema } from "../common/ids.js";
import { IDENTITY_ERRORS } from "./errors.js";
import {
  CodeInput,
  DeviceFields,
  EmailInput,
  MeSchema,
  PasswordInput,
  RecoveryCodeInput,
  SessionTokens,
  SignInResult,
  TokenDelivery,
  TokenInput,
} from "./schemas.js";

const pick = <K extends keyof typeof IDENTITY_ERRORS>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, IDENTITY_ERRORS[k]])) as Pick<typeof IDENTITY_ERRORS, K>;

export const SignUpOptionsSchema = z.object({
  currencies: z.array(z.object({ code: z.string().length(3), minorUnits: z.number().int() })),
  locales: z.array(z.string()),
});

export const InvitationPreviewSchema = z.object({
  invitationId: UuidSchema,
  email: z.string(),
  inviterName: z.string().nullable(),
  expiresAt: InstantWire,
  origin: z.enum(["direct", "account_share", "bootstrap"]),
});

const invitationErrors = pick(
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",
  "INVITATION_REVOKED",
  "INVITATION_USED",
);

export const AuthMethodsSchema = z.object({
  password: z.literal(true),
  google: z.enum(["available", "this_computer_only", "unavailable"]),
});

export const SessionItemSchema = z.object({
  id: UuidSchema,
  deviceLabel: z.string(),
  clientKind: z.enum(["android", "web", "other"]),
  createdAt: InstantWire,
  lastUsedAt: InstantWire,
  current: z.boolean(),
});

const ok = z.object({ ok: z.literal(true) });

export const TwoStepSetupSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  expiresAt: InstantWire,
});

export const RecoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()).length(10) });

export const identityContract = {
  auth: {
    methods: base
      .route({ method: "POST", path: "/auth/methods" })
      .input(z.object({}))
      .output(AuthMethodsSchema),
    signUpOptions: base
      .route({ method: "GET", path: "/auth/sign-up-options" })
      .output(SignUpOptionsSchema),
    signIn: base
      .route({ method: "POST", path: "/auth/sign-in" })
      .errors(pick("INVALID_CREDENTIALS", "ACCOUNT_CLOSED"))
      .input(
        z.object({
          email: EmailInput,
          password: PasswordInput,
          tokenDelivery: TokenDelivery,
          ...DeviceFields,
        }),
      )
      .output(SignInResult),
    verifyTwoStep: base
      .route({ method: "POST", path: "/auth/two-step/verify" })
      .errors(
        pick(
          "TWO_STEP_CHALLENGE_EXPIRED",
          "TWO_STEP_CODE_INVALID",
          "ACCOUNT_CLOSED",
          "GOOGLE_ACCOUNT_IN_USE",
        ),
      )
      .input(
        z.object({
          challengeToken: TokenInput.optional(),
          code: CodeInput.optional(),
          recoveryCode: RecoveryCodeInput.optional(),
          tokenDelivery: TokenDelivery,
          ...DeviceFields,
        }),
      )
      .output(SignInResult),
    refresh: base
      .route({ method: "POST", path: "/auth/refresh" })
      .errors(pick("REFRESH_INVALID"))
      .input(z.object({ tokenDelivery: TokenDelivery, refreshToken: TokenInput.optional() }))
      .output(z.object({ tokens: SessionTokens.nullable(), accessExpiresAt: InstantWire })),
    signOut: base.route({ method: "POST", path: "/auth/sign-out" }).input(z.object({})).output(ok),
  },
  me: {
    get: base.route({ method: "GET", path: "/me" }).output(MeSchema),
    confirm: base
      .route({ method: "POST", path: "/me/confirm" })
      .errors(pick("INVALID_CREDENTIALS", "TWO_STEP_CODE_INVALID"))
      .input(
        z.object({
          password: PasswordInput.optional(),
          code: CodeInput.optional(),
          recoveryCode: RecoveryCodeInput.optional(),
        }),
      )
      .output(z.object({ confirmedUntil: InstantWire })),
    twoStepSetup: base
      .route({ method: "POST", path: "/me/two-step/setup" })
      .errors(pick("CONFIRMATION_REQUIRED", "TWO_STEP_ALREADY_ENABLED"))
      .input(z.object({}))
      .output(TwoStepSetupSchema),
    twoStepEnable: base
      .route({ method: "POST", path: "/me/two-step/enable" })
      .errors(
        pick(
          "CONFIRMATION_REQUIRED",
          "TWO_STEP_SETUP_EXPIRED",
          "TWO_STEP_ALREADY_ENABLED",
          "TWO_STEP_CODE_INVALID",
        ),
      )
      .input(z.object({ code: CodeInput }))
      .output(RecoveryCodesSchema),
    acknowledgeRecoveryCodes: base
      .route({ method: "POST", path: "/me/two-step/acknowledge-codes" })
      .errors(pick("TWO_STEP_NOT_ENABLED"))
      .input(z.object({}))
      .output(ok),
    twoStepDisable: base
      .route({ method: "POST", path: "/me/two-step/disable" })
      .errors(pick("TWO_STEP_NOT_ENABLED", "TWO_STEP_CODE_INVALID"))
      .input(z.object({ code: CodeInput.optional(), recoveryCode: RecoveryCodeInput.optional() }))
      .output(ok),
    regenerateRecoveryCodes: base
      .route({ method: "POST", path: "/me/two-step/recovery-codes" })
      .errors(pick("CONFIRMATION_REQUIRED", "TWO_STEP_NOT_ENABLED"))
      .input(z.object({}))
      .output(RecoveryCodesSchema),
    twoStepReplaceStart: base
      .route({ method: "POST", path: "/me/two-step/replace/start" })
      .errors(pick("CONFIRMATION_REQUIRED", "TWO_STEP_NOT_ENABLED"))
      .input(z.object({}))
      .output(TwoStepSetupSchema),
    twoStepReplaceConfirm: base
      .route({ method: "POST", path: "/me/two-step/replace/confirm" })
      .errors(pick("TWO_STEP_NOT_ENABLED", "TWO_STEP_SETUP_EXPIRED", "TWO_STEP_CODE_INVALID"))
      .input(z.object({ code: CodeInput }))
      .output(ok),
    listSessions: base
      .route({ method: "GET", path: "/me/sessions" })
      .output(z.object({ items: z.array(SessionItemSchema) })),
    revokeSession: base
      .route({ method: "POST", path: "/me/sessions/revoke" })
      .input(z.object({ sessionId: UuidSchema }))
      .output(ok),
    revokeOtherSessions: base
      .route({ method: "POST", path: "/me/sessions/revoke-others" })
      .input(z.object({}))
      .output(z.object({ revoked: z.number().int() })),
  },
  invitations: {
    preview: base
      .route({ method: "POST", path: "/invitations/preview" })
      .errors(invitationErrors)
      .input(z.object({ token: TokenInput }))
      .output(InvitationPreviewSchema),
    accept: base
      .route({ method: "POST", path: "/invitations/accept" })
      .errors({
        ...invitationErrors,
        ...pick(
          "USER_CAP_REACHED",
          "PASSWORD_TOO_WEAK",
          "SIGNUP_TICKET_INVALID",
          "GOOGLE_ACCOUNT_NOT_ALLOWED",
          "GOOGLE_ACCOUNT_IN_USE",
        ),
      })
      .input(
        z.object({
          token: TokenInput,
          displayName: z.string().max(200),
          locale: z.string().max(35),
          timeZone: z.string().max(64),
          baseCurrency: z.string().length(3),
          method: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("password"), password: PasswordInput }),
            z.object({ kind: z.literal("google"), ticket: TokenInput }),
          ]),
          tokenDelivery: TokenDelivery,
          ...DeviceFields,
        }),
      )
      .output(SignInResult),
  },
};
