// F-36: the `me.*` procedures. S-1 has `me.get`.
import { toInstantWire } from "@budmon/shared";
import { authedProcedure } from "../platform/http/procedures.js";
import { getMe } from "./profileService.js";

export const meRouter = {
  get: authedProcedure.me.get.handler(async ({ context }) => {
    const me = await getMe(context.container.identity.deps, context.principal);
    return {
      ...me,
      deletionScheduledFor:
        me.deletionScheduledFor === null ? null : toInstantWire(me.deletionScheduledFor),
      passwordUpdatedAt: me.passwordUpdatedAt === null ? null : toInstantWire(me.passwordUpdatedAt),
      confirmedUntil: me.confirmedUntil === null ? null : toInstantWire(me.confirmedUntil),
    };
  }),
};
