// F-32 for every email kind outside TP-0.17 (invitation) and TP-0.18 (password_reset/_set), from
// §7.2's per-kind table (A-17). TP-0.42 (a) and (b), plus extra cases TP-0.42x.
// TP-0.42 (c), F-118's two direct sends, is S-11's part. IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { Temporal, uuidv7Generator } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import type { SecurityEventKind } from "../../../src/identity/constants.js";
import type { EmailKind } from "../../../src/identity/emailTemplates.js";
import * as exportsRepo from "../../../src/identity/exportsRepo.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import { recordSecurityEvent } from "../../../src/identity/securityEventsService.js";
import type { UserRow } from "../../../src/identity/usersRepo.js";
import { invitationFactory, sessionFactory, userFactory } from "../../factories/identity.js";
import { buildIdentityWorker, T0, type IdentityWorker } from "../../support/identity.js";
import { jobRows } from "../../support/jobs.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

const NOW = Temporal.Instant.from(T0);
const ORIGIN = "http://localhost:5173";
const ZONE = "Africa/Cairo";
const SECURITY_LINK = {
  url: `${ORIGIN}/settings/security`,
  button: "Review your security settings",
};
const SECURITY_OUTRO =
  "If this wasn't you, change your password and review your security settings.";

let w: IdentityWorker;
let h: DbHandle;
let deps: IdentityDeps;

beforeAll(async () => {
  w = await buildIdentityWorker();
  h = w.testDb.database.handle;
  deps = w.container.identity.deps;
  await w.container.boss.start();
});

afterAll(async () => {
  await w.close();
});

beforeEach(async () => {
  await resetBetweenTests(w.testDb);
  w.sender.clear();
  w.jobLog.length = 0;
  w.clock.set(T0);
});

// --- Formats (§7.2: D is dateStyle medium; D+T adds timeStyle short; recipient's locale and zone)

const D = (d: Date): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: ZONE }).format(d);
const DT = (d: Date): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: ZONE }).format(
    d,
  );
const toDate = (i: Temporal.Instant): Date => new Date(i.epochMilliseconds);
/** renderMessage's bidi isolates (U+2066 to U+2069), removed to compare the plain text. */
const plain = (s: string): string => s.replace(/[⁦-⁩]/g, "");

interface Expected {
  to: string;
  subject: string;
  intro: string;
  outro?: string;
  link?: { url: string; button: string };
}

/** Exactly one email: recipient, subject, text (intro, link, outro) and the HTML button. */
function expectOneEmail(e: Expected): void {
  expect(w.sender.sent).toHaveLength(1);
  const m = w.sender.sent[0];
  expect(m?.to).toBe(e.to);
  expect(m?.subject).toBe(e.subject);
  const parts = [e.intro, e.link?.url, e.outro].filter((p): p is string => p !== undefined);
  expect(plain(m?.text ?? "")).toBe(parts.join("\n\n"));
  if (e.link === undefined) {
    expect(m?.html).not.toContain("<a ");
  } else {
    expect(m?.html).toContain(`<a href="${e.link.url}">${e.link.button}</a>`);
  }
}

/** Exactly one info email_skipped line with exactly { reason: kind }, and nothing sent. */
function expectSkipped(kind: string): void {
  expect(w.sender.sent).toEqual([]);
  const skipped = w.jobLog.filter((l) => l.event === "email_skipped");
  expect(skipped).toHaveLength(1);
  expect(skipped[0]?.level).toBe("info");
  expect((skipped[0]?.fields as { fields: unknown }).fields).toEqual({ reason: kind });
}

const send = (payload: Record<string, unknown>) => w.runJob("identity.email-send", payload);
const unknownId = () => uuidv7Generator.next();

const cairoUser = (over: Partial<Omit<UserRow, "createdAt" | "lastActiveAt">> = {}) =>
  userFactory(h, { locale: "en", timeZone: ZONE, email: "mona@example.com", ...over });

/** F-20 for `user`, committed; returns the enqueued job's payload and the event's created_at. */
async function viaF20(
  user: UserRow,
  eventKind: SecurityEventKind,
  email: EmailKind,
  extra: { refId?: string; sessionId?: string } = {},
): Promise<{ payload: Record<string, unknown>; eventAt: Date; eventId: string }> {
  await withTransaction(deps.database, (tx) =>
    recordSecurityEvent(deps, tx, {
      userId: user.id,
      kind: eventKind,
      email,
      ...extra,
    }),
  );
  const { rows } = await h.executeSql(
    "SELECT id, created_at FROM security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [user.id],
  );
  const eventId = String(rows[0]?.["id"]);
  const job = (await jobRows(w.testDb.database, "identity.email-send")).find(
    (j) => (j.data as { eventId?: unknown }).eventId === eventId,
  );
  if (job === undefined) throw new Error("viaF20: no identity.email-send job for the event");
  return {
    payload: job.data as Record<string, unknown>,
    eventAt: rows[0]?.["created_at"] as Date,
    eventId,
  };
}

// --- The kinds dated by their security event

/** [email kind, the F-20 event kind, subject (HLD §4.9), event sentence (A-11)]. */
const EVENT_KINDS: [EmailKind, SecurityEventKind, string, string][] = [
  [
    "password_changed",
    "password_changed",
    "Your Budmon password was changed",
    "Your password was changed",
  ],
  [
    "password_added",
    "password_added",
    "A password was added to your Budmon account",
    "A password was added to your account",
  ],
  [
    "two_step_enabled",
    "two_step_enabled",
    "Two-step verification was turned on",
    "Two-step verification was turned on",
  ],
  [
    "two_step_disabled",
    "two_step_disabled",
    "Two-step verification was turned off",
    "Two-step verification was turned off",
  ],
  [
    "authenticator_replaced",
    "authenticator_replaced",
    "Your two-step verification app was changed",
    "Your two-step verification app was changed",
  ],
  [
    "recovery_codes_regenerated",
    "recovery_codes_regenerated",
    "New recovery codes were created",
    "New recovery codes were created",
  ],
  [
    "recovery_code_used",
    "recovery_code_used",
    "A recovery code was used to sign in",
    "A recovery code was used to sign in",
  ],
  [
    "google_linked",
    "google_linked",
    "Google sign-in was connected to your Budmon account",
    "Google sign-in was connected to your account",
  ],
  [
    "google_unlinked",
    "google_unlinked",
    "Google sign-in was disconnected from your Budmon account",
    "Google sign-in was disconnected from your account",
  ],
];

/** Every kind that loads its security event by eventId, with the F-20 event kind it uses. */
const EVENT_LOADING_KINDS: [EmailKind, SecurityEventKind][] = [
  ...EVENT_KINDS.map(([kind, eventKind]): [EmailKind, SecurityEventKind] => [kind, eventKind]),
  ["two_step_failed", "two_step_failed_sign_in"],
  ["two_step_reset_by_owner", "two_step_reset_by_owner"],
];

describe("TP-0.42 (a): one email per kind, exactly as §7.2's row", () => {
  it.each(EVENT_KINDS)(
    "TP-0.42: %s: subject, '{event} on {date}.' with the event's created_at in Cairo (D+T), outro, link",
    async (kind, eventKind, subject, event) => {
      const user = await cairoUser();
      const { payload, eventAt } = await viaF20(user, eventKind, kind);

      await send(payload);

      expectOneEmail({
        to: user.email,
        subject,
        intro: `${event} on ${DT(eventAt)}.`,
        outro: SECURITY_OUTRO,
        link: SECURITY_LINK,
      });
    },
  );

  it("TP-0.42: two_step_failed: its own intro with the event's created_at (D+T), no {event}", async () => {
    const user = await cairoUser();
    const { payload, eventAt } = await viaF20(user, "two_step_failed_sign_in", "two_step_failed");

    await send(payload);

    expectOneEmail({
      to: user.email,
      subject: "Someone tried to sign in to Budmon and didn't pass two-step verification",
      intro: `Someone got past the first sign-in step for your account but not your two-step code, on ${DT(eventAt)}.`,
      outro: SECURITY_OUTRO,
      link: SECURITY_LINK,
    });
  });

  it("TP-0.42: two_step_reset_by_owner: the user's email and the event's created_at (D+T)", async () => {
    const user = await cairoUser();
    const { payload, eventAt } = await viaF20(
      user,
      "two_step_reset_by_owner",
      "two_step_reset_by_owner",
    );

    await send(payload);

    expectOneEmail({
      to: user.email,
      subject: "Two-step verification was turned off by the administrator",
      intro: `The Budmon administrator turned off two-step verification for mona@example.com on ${DT(eventAt)}.`,
      outro: "If you didn't ask for this, contact the administrator now.",
      link: SECURITY_LINK,
    });
  });

  it("TP-0.42: session_reuse_signed_out: the session's device label and revoked_at (D+T), to the session's user", async () => {
    const user = await cairoUser();
    const revokedAt = NOW.subtract({ minutes: 5 });
    const { sessionId } = await sessionFactory(h, {
      userId: user.id,
      now: NOW.subtract({ hours: 1 }),
      revoked: { reason: "reuse_detected", at: revokedAt },
    });
    const { payload } = await viaF20(user, "refresh_reuse_detected", "session_reuse_signed_out", {
      refId: sessionId,
      sessionId,
    });

    await send(payload);

    expectOneEmail({
      to: user.email,
      subject: "We signed you out of Budmon on Android · Test",
      intro: `For your security, we signed Android · Test out on ${DT(toDate(revokedAt))}, because its sign-in was used twice.`,
      outro: "If that was you, sign in again on that device.",
      link: SECURITY_LINK,
    });
  });

  it("TP-0.42: export_ready: expires_at as a date only (D) in Cairo; no outro; /settings/data", async () => {
    const user = await cairoUser();
    const exportId = unknownId();
    // 23:00 UTC is 01:00 the next day in Cairo: the date shown is Cairo's.
    const expiresAt = new Date("2026-11-09T23:00:00.000Z");
    await exportsRepo.insertQueued(h, { id: exportId, userId: user.id, requestedAt: toDate(NOW) });
    await exportsRepo.markReady(h, exportId, {
      objectKey: `exports/${exportId}.zip`,
      byteSize: 10,
      completedAt: toDate(NOW),
      expiresAt,
    });

    await send({ kind: "export_ready", refId: exportId });

    expect(D(expiresAt)).toBe("Nov 10, 2026");
    expectOneEmail({
      to: user.email,
      subject: "Your Budmon export is ready",
      intro: "Your export is ready. Download it before Nov 10, 2026.",
      link: { url: `${ORIGIN}/settings/data`, button: "Go to your data" },
    });
  });

  it("TP-0.42: deletion_scheduled: deletion_scheduled_for (D+T) in subject and intro; outro; /sign-in", async () => {
    const scheduledFor = toDate(NOW.add({ hours: 24 * 7 }));
    const user = await cairoUser({
      status: "pending_deletion",
      deletionRequestedAt: toDate(NOW),
      deletionScheduledFor: scheduledFor,
      deletionRequestedBy: "self",
    });

    await send({ kind: "deletion_scheduled", refId: user.id });

    expectOneEmail({
      to: user.email,
      subject: `Your Budmon account will be deleted on ${DT(scheduledFor)}`,
      intro: `Your account and everything you own in Budmon will be erased on ${DT(scheduledFor)}.`,
      outro: "Sign in before then to keep your account or to download your data.",
      link: { url: `${ORIGIN}/sign-in`, button: "Sign in" },
    });
  });

  it("TP-0.42: deletion_cancelled: intro only, no link", async () => {
    const user = await cairoUser();

    await send({ kind: "deletion_cancelled", refId: user.id });

    expectOneEmail({
      to: user.email,
      subject: "Your Budmon account won't be deleted",
      intro: "Your account won't be deleted. Reconnect your Gmail and SMS in Sources.",
    });
  });

  it("TP-0.42: account_closed_owner: deletion_requested_at and deletion_scheduled_for (both D+T); no link", async () => {
    const requestedAt = toDate(NOW.subtract({ minutes: 3 }));
    const scheduledFor = toDate(NOW.add({ hours: 24 * 7 }));
    const owner = await userFactory(h, { isProductOwner: true });
    expect(owner.isProductOwner).toBe(true);
    const user = await cairoUser({
      status: "pending_deletion",
      deletionRequestedAt: requestedAt,
      deletionScheduledFor: scheduledFor,
      deletionRequestedBy: "owner",
    });

    await send({ kind: "account_closed_owner", refId: user.id });

    expectOneEmail({
      to: user.email,
      subject: "Your Budmon account has been closed",
      intro: `The Budmon administrator closed your account on ${DT(requestedAt)}. Your data will be erased on ${DT(scheduledFor)}.`,
    });
  });

  it("TP-0.42: invitation_cap_failed to the inviter: the invitation's email; no date, outro or link", async () => {
    const inviter = await cairoUser({ displayName: "Ahmed" });
    const { invitationId } = await invitationFactory(h, {
      email: "newbie@example.com",
      now: NOW,
      inviterUserId: inviter.id,
    });

    await send({ kind: "invitation_cap_failed", refId: invitationId, recipient: "inviter" });

    expectOneEmail({
      to: inviter.email,
      subject: "newbie@example.com couldn't join Budmon",
      intro:
        "Budmon has reached its user limit, so newbie@example.com couldn't create an account. The administrator has been told.",
    });
  });

  it("TP-0.42: invitation_cap_failed to the owner: sent to the user with is_product_owner", async () => {
    const inviter = await cairoUser({ displayName: "Ahmed" });
    const owner = await userFactory(h, {
      isProductOwner: true,
      email: "owner@example.com",
      locale: "en",
      timeZone: ZONE,
    });
    const { invitationId } = await invitationFactory(h, {
      email: "newbie@example.com",
      now: NOW,
      inviterUserId: inviter.id,
    });

    await send({ kind: "invitation_cap_failed", refId: invitationId, recipient: "owner" });

    expectOneEmail({
      to: owner.email,
      subject: "newbie@example.com couldn't join Budmon",
      intro:
        "Budmon has reached its user limit, so newbie@example.com couldn't create an account. The administrator has been told.",
    });
  });
});

describe("TP-0.42 (b): each skip condition of §7.2's table", () => {
  it.each(EVENT_LOADING_KINDS)("TP-0.42: %s: the user doesn't exist → skipped", async (kind) => {
    await send({ kind, refId: unknownId(), eventId: unknownId() });

    expectSkipped(kind);
  });

  it.each(EVENT_LOADING_KINDS)("TP-0.42: %s: eventId absent → skipped", async (kind) => {
    const user = await cairoUser();

    await send({ kind, refId: user.id });

    expectSkipped(kind);
  });

  it.each(EVENT_LOADING_KINDS)("TP-0.42: %s: no event has the eventId → skipped", async (kind) => {
    const user = await cairoUser();

    await send({ kind, refId: user.id, eventId: unknownId() });

    expectSkipped(kind);
  });

  it.each(EVENT_LOADING_KINDS)(
    "TP-0.42: %s: the event belongs to another user → skipped",
    async (kind, eventKind) => {
      const user = await cairoUser();
      const other = await userFactory(h);
      const { eventId } = await viaF20(other, eventKind, kind);
      w.jobLog.length = 0;

      await send({ kind, refId: user.id, eventId });

      expectSkipped(kind);
    },
  );

  it("TP-0.42: session_reuse_signed_out: the session doesn't exist → skipped", async () => {
    await send({ kind: "session_reuse_signed_out", refId: unknownId(), eventId: unknownId() });

    expectSkipped("session_reuse_signed_out");
  });

  it("TP-0.42: export_ready: the export isn't ready (queued) → skipped", async () => {
    const user = await cairoUser();
    const exportId = unknownId();
    await exportsRepo.insertQueued(h, { id: exportId, userId: user.id, requestedAt: toDate(NOW) });

    await send({ kind: "export_ready", refId: exportId });

    expectSkipped("export_ready");
  });

  it.each(["deletion_scheduled", "deletion_cancelled", "account_closed_owner"])(
    "TP-0.42: %s: the user doesn't exist → skipped",
    async (kind) => {
      await send({ kind, refId: unknownId() });

      expectSkipped(kind);
    },
  );

  it.each(["deletion_scheduled", "account_closed_owner"])(
    "TP-0.42: %s: deletion_scheduled_for is null (cancelled before the job ran) → skipped",
    async (kind) => {
      const user = await cairoUser();
      expect(user.deletionScheduledFor).toBeNull();

      await send({ kind, refId: user.id });

      expectSkipped(kind);
    },
  );

  it("TP-0.42: invitation_cap_failed without recipient → skipped", async () => {
    const inviter = await cairoUser();
    const { invitationId } = await invitationFactory(h, {
      email: "newbie@example.com",
      now: NOW,
      inviterUserId: inviter.id,
    });

    await send({ kind: "invitation_cap_failed", refId: invitationId });

    expectSkipped("invitation_cap_failed");
  });

  it("TP-0.42: invitation_cap_failed to an erased inviter (none recorded) → skipped", async () => {
    await userFactory(h, { isProductOwner: true });
    const { invitationId } = await invitationFactory(h, {
      email: "newbie@example.com",
      now: NOW,
      inviterUserId: null,
    });

    await send({ kind: "invitation_cap_failed", refId: invitationId, recipient: "inviter" });

    expectSkipped("invitation_cap_failed");
  });

  it("TP-0.42: invitation_cap_failed to the owner with no owner yet → skipped", async () => {
    const inviter = await cairoUser();
    const { invitationId } = await invitationFactory(h, {
      email: "newbie@example.com",
      now: NOW,
      inviterUserId: inviter.id,
    });

    await send({ kind: "invitation_cap_failed", refId: invitationId, recipient: "owner" });

    expectSkipped("invitation_cap_failed");
  });

  it("TP-0.42x: invitation_cap_failed for an invitation that doesn't exist → skipped", async () => {
    await userFactory(h, { isProductOwner: true });

    await send({ kind: "invitation_cap_failed", refId: unknownId(), recipient: "owner" });

    expectSkipped("invitation_cap_failed");
  });
});
