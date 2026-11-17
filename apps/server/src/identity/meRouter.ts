// F-36: the `me.*` procedures. S-1 has `me.get`; S-3 adds step-up and session management.
import { toInstantWire } from "@budmon/shared";
import { authedProcedure } from "../platform/http/procedures.js";
import { getMe } from "./profileService.js";
import { reqInfoFrom } from "./requestInfo.js";
import { listSessions, revokeOtherSessions, revokeOwnSession } from "./sessionService.js";
import { confirmIdentity } from "./stepUpService.js";

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
  confirm: authedProcedure.me.confirm.handler(async ({ input, context }) => {
    const result = await confirmIdentity(
      context.container.identity.deps,
      context.principal,
      {
        password: input.password ?? null,
        code: input.code ?? null,
        recoveryCode: input.recoveryCode ?? null,
      },
      reqInfoFrom(context),
    );
    return { confirmedUntil: toInstantWire(result.confirmedUntil) };
  }),
  listSessions: authedProcedure.me.listSessions.handler(async ({ context }) => {
    const items = await listSessions(context.container.identity.deps, context.principal);
    return {
      items: items.map((i) => ({
        ...i,
        createdAt: toInstantWire(i.createdAt),
        lastUsedAt: toInstantWire(i.lastUsedAt),
      })),
    };
  }),
  revokeSession: authedProcedure.me.revokeSession.handler(async ({ input, context }) => {
    await revokeOwnSession(context.container.identity.deps, context.principal, input.sessionId);
    return { ok: true as const };
  }),
  revokeOtherSessions: authedProcedure.me.revokeOtherSessions.handler(async ({ context }) =>
    revokeOtherSessions(context.container.identity.deps, context.principal),
  ),
};
