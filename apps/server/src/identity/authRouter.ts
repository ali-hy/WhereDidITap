// F-36: the `auth.*` procedures: sign-up options (S-1), methods, sign-in, refresh and sign-out (S-3).
import { toInstantWire } from "@budmon/shared";
import { ForbiddenError, ValidationFailedError } from "../platform/errors/platformErrors.js";
import { authedProcedure, publicProcedure } from "../platform/http/procedures.js";
import { readCookie } from "./cookies.js";
import { clearSessionCookies, deliverChallenge, deliverSession } from "./deliver.js";
import { reqInfoFrom } from "./requestInfo.js";
import { refreshSession, signOut } from "./sessionService.js";
import {
  authMethods,
  signInWithPassword,
  signUpOptions,
  verifyTwoStepAtSignIn,
} from "./signInService.js";

export const authRouter = {
  methods: publicProcedure.auth.methods.handler(({ context }) =>
    authMethods(
      context.container.identity.deps.config.api?.googleSignIn,
      context.headers["origin"] ?? null,
    ),
  ),
  signUpOptions: publicProcedure.auth.signUpOptions.handler(({ context }) =>
    signUpOptions(context.container.identity.deps),
  ),
  signIn: publicProcedure.auth.signIn.handler(async ({ input, context }) => {
    // Login CSRF: cookies are only set for the web client (HLD §7.1).
    if (input.tokenDelivery === "cookie" && context.clientKind !== "web")
      throw new ForbiddenError();
    const req = reqInfoFrom(context, input);
    const outcome = await signInWithPassword(
      context.container.identity.deps,
      {
        email: input.email,
        password: input.password,
        delivery: input.tokenDelivery === "cookie" ? "cookie" : "bearer",
        presentedDeviceToken: req.presentedDeviceToken,
      },
      req,
    );
    if (outcome.status === "signed_in") {
      return {
        status: "signed_in" as const,
        tokens: deliverSession(context, outcome.session),
        recoveryCodesLeft: outcome.recoveryCodesLeft,
      };
    }
    return {
      status: "two_step_required" as const,
      challengeToken: deliverChallenge(
        context,
        outcome.challengeToken,
        outcome.expiresAt,
        outcome.delivery,
      ),
      expiresAt: toInstantWire(outcome.expiresAt),
    };
  }),
  verifyTwoStep: publicProcedure.auth.verifyTwoStep.handler(async ({ input, context }) => {
    if (input.tokenDelivery === "cookie" && context.clientKind !== "web")
      throw new ForbiddenError();
    const req = reqInfoFrom(context, input);
    const delivery = input.tokenDelivery === "cookie" ? "cookie" : "bearer";
    const outcome = await verifyTwoStepAtSignIn(
      context.container.identity.deps,
      {
        challengeToken:
          delivery === "cookie"
            ? readCookie("challenge", req.cookies, req.host)
            : (input.challengeToken ?? null),
        code: input.code ?? null,
        recoveryCode: input.recoveryCode ?? null,
        delivery,
        presentedDeviceToken: req.presentedDeviceToken,
      },
      req,
    );
    return {
      status: "signed_in" as const,
      tokens: deliverSession(context, outcome.session),
      recoveryCodesLeft: outcome.recoveryCodesLeft,
    };
  }),
  refresh: publicProcedure.auth.refresh.handler(async ({ input, context }) => {
    if (input.tokenDelivery === "cookie" && context.clientKind !== "web")
      throw new ForbiddenError();
    const req = reqInfoFrom(context, input);
    let refreshToken: string | null;
    if (input.tokenDelivery === "cookie") {
      refreshToken = readCookie("refresh", req.cookies, req.host);
    } else {
      if (input.refreshToken === undefined) {
        throw new ValidationFailedError([
          { path: ["refreshToken"], code: "required", message: "Required" },
        ]);
      }
      refreshToken = input.refreshToken;
    }
    const session = await refreshSession(context.container.identity.deps, {
      refreshToken,
      channel: input.tokenDelivery === "cookie" ? "cookie" : "bearer",
      req,
    });
    return {
      tokens: deliverSession(context, session),
      accessExpiresAt: toInstantWire(session.accessExpiresAt),
    };
  }),
  signOut: authedProcedure.auth.signOut.handler(async ({ context }) => {
    await signOut(context.container.identity.deps, context.principal);
    clearSessionCookies(context);
    return { ok: true as const };
  }),
};
