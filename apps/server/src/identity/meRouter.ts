// F-36: the `me.*` procedures. S-1 has `me.get`; S-3 adds step-up and session management.
import { toInstantWire } from "@budmon/shared";
import { authedProcedure } from "../platform/http/procedures.js";
import { getMe } from "./profileService.js";
import { reqInfoFrom } from "./requestInfo.js";
import { listSessions, revokeOtherSessions, revokeOwnSession } from "./sessionService.js";
import { confirmIdentity } from "./stepUpService.js";
import {
  acknowledgeRecoveryCodes,
  regenerateRecoveryCodes,
  twoStepDisable,
  twoStepEnable,
  twoStepReplaceConfirm,
  twoStepReplaceStart,
  twoStepSetup,
} from "./twoStepService.js";

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
  twoStepSetup: authedProcedure.me.twoStepSetup.handler(async ({ context }) => {
    const r = await twoStepSetup(context.container.identity.deps, context.principal);
    return { ...r, expiresAt: toInstantWire(r.expiresAt) };
  }),
  twoStepEnable: authedProcedure.me.twoStepEnable.handler(({ input, context }) =>
    twoStepEnable(
      context.container.identity.deps,
      context.principal,
      { code: input.code },
      reqInfoFrom(context),
    ),
  ),
  acknowledgeRecoveryCodes: authedProcedure.me.acknowledgeRecoveryCodes.handler(
    async ({ context }) => {
      await acknowledgeRecoveryCodes(context.container.identity.deps, context.principal);
      return { ok: true as const };
    },
  ),
  twoStepDisable: authedProcedure.me.twoStepDisable.handler(async ({ input, context }) => {
    await twoStepDisable(
      context.container.identity.deps,
      context.principal,
      { code: input.code ?? null, recoveryCode: input.recoveryCode ?? null },
      reqInfoFrom(context),
    );
    return { ok: true as const };
  }),
  regenerateRecoveryCodes: authedProcedure.me.regenerateRecoveryCodes.handler(({ context }) =>
    regenerateRecoveryCodes(
      context.container.identity.deps,
      context.principal,
      reqInfoFrom(context),
    ),
  ),
  twoStepReplaceStart: authedProcedure.me.twoStepReplaceStart.handler(async ({ context }) => {
    const r = await twoStepReplaceStart(context.container.identity.deps, context.principal);
    return { ...r, expiresAt: toInstantWire(r.expiresAt) };
  }),
  twoStepReplaceConfirm: authedProcedure.me.twoStepReplaceConfirm.handler(
    async ({ input, context }) => {
      await twoStepReplaceConfirm(
        context.container.identity.deps,
        context.principal,
        { code: input.code },
        reqInfoFrom(context),
      );
      return { ok: true as const };
    },
  ),
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
