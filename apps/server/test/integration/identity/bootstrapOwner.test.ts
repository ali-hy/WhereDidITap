// F-45 bootstrapOwner (identity LLD §4.3, S-2, A-66) against a real database. TP-2.1, TP-2.2, plus extra
// cases TP-2.2x. The CLI (F-46) is bootstrapOwnerCli.test.ts; the accept side (TP-2.3, TP-2.4) is
// bootstrapAccept.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { BootstrapError, bootstrapOwner } from "../../../src/identity/bootstrapService.js";
import { INVITATION_TTL } from "../../../src/identity/constants.js";
import { normaliseEmail } from "../../../src/identity/emailAddress.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import * as invitationsRepo from "../../../src/identity/invitationsRepo.js";
import { hashToken } from "../../../src/identity/tokens.js";
import { invitationFactory, userFactory } from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { jobRows, templateJobRegistry, TEST_JOBS, type JobDefinition } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let h: DbHandle;
let deps: IdentityDeps;
const NOW = Temporal.Instant.from(T0);
const OWNER_EMAIL = "Owner@X.com";

/** A subscriber on the template's test.ok queue, recording identity.invitation-ended payloads. */
const recorder = {
  ...TEST_JOBS.ok,
  payload: z.record(z.string(), z.unknown()),
} as unknown as JobDefinition<never>;

beforeAll(async () => {
  api = await buildIdentityApi({ overrides: { registry: templateJobRegistry() } });
  api.container.identity.events.subscribe("identity.invitation-ended", recorder);
  await api.container.boss.start();
  h = api.testDb.database.handle;
  deps = api.container.identity.deps;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

/** The invitation-ended payloads published, oldest first. */
const ended = async (): Promise<Record<string, unknown>[]> =>
  (await jobRows(api.testDb.database, TEST_JOBS.ok.name)).map(
    (r) => r.data as Record<string, unknown>,
  );

const emailJobs = async () => jobRows(api.testDb.database, "identity.email-send");

const invitations = async (): Promise<Record<string, unknown>[]> =>
  (
    await h.executeSql(
      "SELECT id, email, inviter_user_id, origin, status, token_hash, token_issued_at, expires_at, revoked_by_user_id FROM invitations ORDER BY created_at, id",
    )
  ).rows;

/** The token in a bootstrap link, which must be `<api.publicOrigin>/invite#t=<token>`. */
function tokenOf(link: string): string {
  const origin = deps.config.api?.publicOrigin.origin;
  const match = new RegExp(
    `^${String(origin).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/invite#t=(bmi_[A-Za-z0-9_-]{43})$`,
  ).exec(link);
  expect(match, `link ${link}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** The BootstrapError a call rejects with. */
async function refusal(call: Promise<unknown>): Promise<BootstrapError> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BootstrapError);
  return error as BootstrapError;
}

const pendingBootstrap = (expiresAt?: Temporal.Instant) =>
  invitationFactory(h, {
    email: "first-owner@example.com",
    origin: "bootstrap",
    now: NOW,
    withToken: true,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });

describe("TP-2.1: bootstrapOwner on an empty database", () => {
  it("TP-2.1: Owner@X.com → one pending bootstrap invitation, no inviter, its token hash the link's token, expiring in INVITATION_TTL, no email job", async () => {
    const r = await bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false });

    const token = tokenOf(r.link);
    expect(r.expiresAt.equals(NOW.add(INVITATION_TTL))).toBe(true);
    const rows = await invitations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: normaliseEmail(OWNER_EMAIL),
      inviter_user_id: null,
      origin: "bootstrap",
      status: "pending",
    });
    expect(Buffer.from(rows[0]?.["token_hash"] as Buffer).equals(hashToken(token))).toBe(true);
    expect((rows[0]?.["token_issued_at"] as Date).getTime()).toBe(NOW.epochMilliseconds);
    expect((rows[0]?.["expires_at"] as Date).getTime()).toBe(
      NOW.add(INVITATION_TTL).epochMilliseconds,
    );
    // A-66: the result names the inserted row and carries its expiry.
    expect(r.invitationId).toBe(rows[0]?.["id"]);
    expect(r.expiresAt.epochMilliseconds).toBe((rows[0]?.["expires_at"] as Date).getTime());
    expect(await emailJobs()).toEqual([]);
    expect(await ended()).toEqual([]);
  });

  it("TP-2.1x: the link's token finds the invitation through its hash", async () => {
    const r = await bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false });

    const found = await invitationsRepo.findByTokenHash(h, hashToken(tokenOf(r.link)));

    expect(found).toMatchObject({ origin: "bootstrap", status: "pending", inviterUserId: null });
  });
});

describe("TP-2.2: bootstrapOwner's refusals and replacements", () => {
  it("TP-2.2: an owner exists → owner_exists; nothing inserted", async () => {
    await userFactory(h, { isProductOwner: true, inviteAllowance: null });

    const e = await refusal(bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false }));

    expect(e.code).toBe("owner_exists");
    expect(await invitations()).toEqual([]);
  });

  it("TP-2.2: a pending bootstrap without replace → pending_exists with its expiresAt; nothing changes", async () => {
    const expiresAt = NOW.add({ hours: 30 });
    const old = await pendingBootstrap(expiresAt);

    const e = await refusal(bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false }));

    expect(e.code).toBe("pending_exists");
    expect(e.expiresAt?.epochMilliseconds).toBe(expiresAt.epochMilliseconds);
    const rows = await invitations();
    expect(rows.map((r) => [r["id"], r["status"]])).toEqual([[old.invitationId, "pending"]]);
    expect(await ended()).toEqual([]);
  });

  it("TP-2.2: a pending bootstrap with replace → the old one revoked (by nobody) with an invitation-ended { revoked } job, and a new one created", async () => {
    const old = await pendingBootstrap(NOW.add({ hours: 30 }));

    const r = await bootstrapOwner(deps, { email: OWNER_EMAIL, replace: true });

    const rows = await invitations();
    const before = rows.find((x) => x["id"] === old.invitationId);
    expect(before).toMatchObject({ status: "revoked", revoked_by_user_id: null });
    const created = rows.filter((x) => x["id"] !== old.invitationId);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ origin: "bootstrap", status: "pending" });
    expect(
      Buffer.from(created[0]?.["token_hash"] as Buffer).equals(hashToken(tokenOf(r.link))),
    ).toBe(true);
    expect(await ended()).toEqual([{ invitationId: old.invitationId, reason: "revoked" }]);
  });

  it("TP-2.2: an expired pending bootstrap (no replace needed) → the old one expired with an invitation-ended { expired } job, and a new one created", async () => {
    const old = await pendingBootstrap(NOW.subtract({ minutes: 1 }));

    await bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false });

    const rows = await invitations();
    expect(rows.find((x) => x["id"] === old.invitationId)).toMatchObject({ status: "expired" });
    const created = rows.filter((x) => x["id"] !== old.invitationId);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ origin: "bootstrap", status: "pending" });
    expect(await ended()).toEqual([{ invitationId: old.invitationId, reason: "expired" }]);
  });

  it("TP-2.2: a user with the email (no owner) → email_in_use; nothing inserted", async () => {
    await userFactory(h, { email: normaliseEmail(OWNER_EMAIL) });

    const e = await refusal(bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false }));

    expect(e.code).toBe("email_in_use");
    expect(await invitations()).toEqual([]);
  });

  it('TP-2.2: "x" → invalid_email; nothing inserted', async () => {
    const e = await refusal(bootstrapOwner(deps, { email: "x", replace: false }));

    expect(e.code).toBe("invalid_email");
    expect(await invitations()).toEqual([]);
  });

  it("TP-2.2: a pending direct invitation for the email from someone else → revoked with its invitation-ended { revoked } job; the bootstrap one created", async () => {
    const inviter = await userFactory(h, { displayName: "Ahmed Ali" });
    const direct = await invitationFactory(h, {
      email: normaliseEmail(OWNER_EMAIL),
      inviterUserId: inviter.id,
      now: NOW,
      withToken: true,
    });

    await bootstrapOwner(deps, { email: OWNER_EMAIL, replace: false });

    const rows = await invitations();
    expect(rows.find((x) => x["id"] === direct.invitationId)).toMatchObject({ status: "revoked" });
    const created = rows.filter((x) => x["origin"] === "bootstrap");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: "pending", email: normaliseEmail(OWNER_EMAIL) });
    expect(await ended()).toEqual([{ invitationId: direct.invitationId, reason: "revoked" }]);
  });

  it("TP-2.2x: owner_exists is checked before pending_exists (an owner and a pending bootstrap) → owner_exists", async () => {
    await userFactory(h, { isProductOwner: true, inviteAllowance: null });
    await pendingBootstrap(NOW.add({ hours: 30 }));

    const e = await refusal(bootstrapOwner(deps, { email: OWNER_EMAIL, replace: true }));

    expect(e.code).toBe("owner_exists");
  });
});
