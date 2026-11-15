// F-36: the `invitations.*` procedures. S-1 has the public preview and accept.
import { toInstantWire } from "@budmon/shared";
import { ForbiddenError } from "../platform/errors/platformErrors.js";
import { publicProcedure } from "../platform/http/procedures.js";
import { deliverSession } from "./deliver.js";
import { acceptInvitation, previewInvitation } from "./invitationService.js";
import { reqInfoFrom } from "./requestInfo.js";

export const invitationsRouter = {
  preview: publicProcedure.invitations.preview.handler(async ({ input, context }) => {
    const preview = await previewInvitation(
      context.container.identity.deps,
      input,
      reqInfoFrom(context),
    );
    return { ...preview, expiresAt: toInstantWire(preview.expiresAt) };
  }),
  accept: publicProcedure.invitations.accept.handler(async ({ input, context }) => {
    // Login CSRF: cookies are only set for the web client (HLD §7.1).
    if (input.tokenDelivery === "cookie" && context.clientKind !== "web")
      throw new ForbiddenError();
    const session = await acceptInvitation(
      context.container.identity.deps,
      {
        token: input.token,
        displayName: input.displayName,
        locale: input.locale,
        timeZone: input.timeZone,
        baseCurrency: input.baseCurrency,
        method: input.method,
        delivery: input.tokenDelivery === "cookie" ? "cookie" : "bearer",
        presentedDeviceToken: reqInfoFrom(context, input).presentedDeviceToken,
      },
      reqInfoFrom(context, input),
    );
    return {
      status: "signed_in" as const,
      tokens: deliverSession(context, session),
      recoveryCodesLeft: null,
    };
  }),
};
