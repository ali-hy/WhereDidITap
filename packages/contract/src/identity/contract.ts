// F-35, §5: identity's procedures. Each slice adds its own; S-1 has sign-up, `me.get` and the
// sign-up options.
import { z } from "zod";
import { base } from "../common/errors.js";
import { InstantWire } from "../common/dates.js";
import { UuidSchema } from "../common/ids.js";
import { IDENTITY_ERRORS } from "./errors.js";
import {
  DeviceFields,
  MeSchema,
  PasswordInput,
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

export const identityContract = {
  auth: {
    signUpOptions: base
      .route({ method: "GET", path: "/auth/sign-up-options" })
      .output(SignUpOptionsSchema),
  },
  me: {
    get: base.route({ method: "GET", path: "/me" }).output(MeSchema),
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
