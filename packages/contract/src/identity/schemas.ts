// F-35, §5.1: identity's shared wire schemas.
import { z } from "zod";
import { InstantWire } from "../common/dates.js";
import { UuidSchema } from "../common/ids.js";

/** Normalised and validated by the service. */
export const EmailInput = z.string().min(1).max(320);
/** The policy is checked by the service (F-38). */
export const PasswordInput = z.string().min(1).max(1024);
/** Parsed by the service (F-2). */
export const TokenInput = z.string().min(1).max(128);
/** TOTP; spaces allowed. */
export const CodeInput = z.string().min(6).max(16);
export const RecoveryCodeInput = z.string().min(12).max(32);
export const TokenDelivery = z.enum(["cookie", "body"]);
export const DeviceFields = {
  deviceModel: z.string().max(100).optional(),
  deviceToken: z.string().max(128).optional(),
};
export const ReturnTo = z
  .string()
  .max(201)
  .regex(/^\/[A-Za-z0-9/_-]{0,200}$/);

export const SessionTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: InstantWire,
  refreshExpiresAt: InstantWire,
  deviceToken: z.string().nullable(),
});

export const SignInResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("signed_in"),
    tokens: SessionTokens.nullable(),
    recoveryCodesLeft: z.number().int().nullable(),
  }),
  z.object({
    status: z.literal("two_step_required"),
    challengeToken: z.string().nullable(),
    expiresAt: InstantWire,
  }),
]);

export const GoogleResult = z.discriminatedUnion("status", [
  SignInResult.options[0].extend({ returnTo: ReturnTo }),
  SignInResult.options[1].extend({ returnTo: ReturnTo }),
  z.object({
    status: z.literal("sign_up"),
    signUpTicket: z.string(),
    googleEmail: z.string(),
    suggestedName: z.string().nullable(),
    returnTo: ReturnTo,
  }),
  z.object({ status: z.literal("linked"), returnTo: ReturnTo }),
  z.object({
    status: z.literal("confirmed"),
    confirmedUntil: InstantWire,
    returnTo: ReturnTo,
  }),
]);

export const MeSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  displayName: z.string(),
  locale: z.string(),
  timeZone: z.string(),
  baseCurrency: z.string().length(3),
  status: z.enum(["active", "pending_deletion"]),
  deletionScheduledFor: InstantWire.nullable(),
  isOwner: z.boolean(),
  hasPassword: z.boolean(),
  passwordUpdatedAt: InstantWire.nullable(),
  google: z.object({ email: z.string() }).nullable(),
  twoStep: z.object({
    enabled: z.boolean(),
    recoveryCodesLeft: z.number().int(),
    codesAcknowledged: z.boolean(),
  }),
  confirmedUntil: InstantWire.nullable(),
  sessionId: UuidSchema,
});

export const ProfilePatch = z.object({
  displayName: z.string().max(200).optional(),
  locale: z.string().max(35).optional(),
  timeZone: z.string().max(64).optional(),
  baseCurrency: z.string().length(3).optional(),
});
