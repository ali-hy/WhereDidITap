// F-32 handleEmailSend through identity.email-send's handler (identity LLD §4.1, §7.2). TP-0.17 and
// TP-0.18 (with A-1 and A-6), plus extra cases TP-0.17x and TP-0.18x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { EmailSendError } from "../../../src/identity/emailSender.js";
import { hashToken } from "../../../src/identity/tokens.js";
import {
  invitationFactory,
  passwordFactory,
  resetFactory,
  userFactory,
} from "../../factories/identity.js";
import { buildIdentityWorker, T0, type IdentityWorker } from "../../support/identity.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

const NOW = Temporal.Instant.from(T0);
const ORIGIN = "http://localhost:5173";
const counter = () => ({ add: vi.fn() });
const metrics = {
  signIns: counter(),
  refreshes: counter(),
  refreshReuse: counter(),
  twoStep: counter(),
  emails: counter(),
  exports: counter(),
  erasures: counter(),
};

let w: IdentityWorker;
let h: DbHandle;

beforeAll(async () => {
  w = await buildIdentityWorker({
    identityOverrides: { metrics },
  });
  h = w.testDb.database.handle;
});

afterAll(async () => {
  await w.close();
});

beforeEach(async () => {
  await resetBetweenTests(w.testDb);
  w.sender.clear();
  w.jobLog.length = 0;
  w.clock.set(T0);
  for (const c of Object.values(metrics)) c.add.mockClear();
});

const linkToken = (text: string, path: string): string => {
  const match = new RegExp(`${ORIGIN}${path}#t=(bm[a-z]_[A-Za-z0-9_-]{43})`).exec(text);
  if (match?.[1] === undefined) throw new Error(`no ${path} link in the email`);
  return match[1];
};

async function invitationRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await h.executeSql("SELECT * FROM invitations WHERE id = $1", [id]);
  return rows[0] ?? {};
}

async function pendingInvitation(email = "invitee@example.com") {
  const inviter = await userFactory(h, { displayName: "Ahmed" });
  const { invitationId } = await invitationFactory(h, {
    email,
    now: NOW,
    inviterUserId: inviter.id,
  });
  return { inviter, invitationId, email };
}

const run = (kind: string, refId: string, attempt = 1) =>
  w.runJob("identity.email-send", { kind, refId }, attempt);
const failed = () => w.jobLog.filter((l) => l.event === "email_failed");
const fieldsOf = (l: { fields: unknown }) => (l.fields as { fields: unknown }).fields;

describe("TP-0.17: the invitation email job", () => {
  it("TP-0.17: sends the email; the stored token hash equals hashToken of the link's token", async () => {
    const { invitationId, email } = await pendingInvitation();

    await run("invitation", invitationId);

    expect(w.sender.sent).toHaveLength(1);
    const sent = w.sender.sent[0];
    expect(sent?.to).toBe(email);
    expect(sent?.subject).toBe("Ahmed invited you to Budmon");
    const token = linkToken(sent?.text ?? "", "/invite");
    const row = await invitationRow(invitationId);
    expect((row["token_hash"] as Buffer).equals(hashToken(token))).toBe(true);
    expect(row["send_count"]).toBe(1);
    expect(row["last_sent_at"]).not.toBeNull();
    expect(row["send_failed_at"]).toBeNull();
  });

  it("TP-0.17: a second run (a retry) issues a different token, and the first no longer matches", async () => {
    const { invitationId } = await pendingInvitation();

    await run("invitation", invitationId);
    await run("invitation", invitationId, 2);

    const first = linkToken(w.sender.sent[0]?.text ?? "", "/invite");
    const second = linkToken(w.sender.sent[1]?.text ?? "", "/invite");
    expect(second).not.toBe(first);
    const stored = (await invitationRow(invitationId))["token_hash"] as Buffer;
    expect(stored.equals(hashToken(second))).toBe(true);
    expect(stored.equals(hashToken(first))).toBe(false);
  });

  it("TP-0.17: a revoked invitation is skipped: nothing sent, info email_skipped with exactly { reason: invitation }", async () => {
    const { invitationId } = await invitationFactory(h, {
      email: "gone@example.com",
      now: NOW,
      revokedAt: NOW,
    });

    await expect(run("invitation", invitationId)).resolves.toBeUndefined();

    expect(w.sender.sent).toEqual([]);
    const skipped = w.jobLog.filter((l) => l.event === "email_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.level).toBe("info");
    expect(fieldsOf(skipped[0] as { fields: unknown })).toEqual({ reason: "invitation" });
    expect((await invitationRow(invitationId))["token_hash"]).toBeNull();
  });

  it("TP-0.17: a permanent failure sets send_failed_at, completes, and logs warn email_failed with exactly { reason, errorCode }", async () => {
    const { invitationId } = await pendingInvitation();
    w.sender.failNext(new EmailSendError("smtp_EENVELOPE", { permanent: true }));

    await expect(run("invitation", invitationId)).resolves.toBeUndefined();

    expect((await invitationRow(invitationId))["send_failed_at"]).not.toBeNull();
    expect(failed()).toHaveLength(1);
    expect(failed()[0]?.level).toBe("warn");
    expect(fieldsOf(failed()[0] as { fields: unknown })).toEqual({
      reason: "invitation",
      errorCode: "smtp_EENVELOPE",
    });
    expect(metrics.emails.add).toHaveBeenCalledWith(1, { error_key: "EMAIL_PERMANENT" });
  });

  it("TP-0.17: a transient failure on attempt 6 (the last) sets send_failed_at and rethrows; no email_failed line", async () => {
    const { invitationId } = await pendingInvitation();
    const error = new EmailSendError("smtp_ETIMEDOUT", { permanent: false });
    w.sender.failNext(error);

    await expect(run("invitation", invitationId, 6)).rejects.toBe(error);

    expect((await invitationRow(invitationId))["send_failed_at"]).not.toBeNull();
    expect(failed()).toEqual([]);
  });

  it("TP-0.17: a transient failure on attempt 2 rethrows without marking; no email_failed line", async () => {
    const { invitationId } = await pendingInvitation();
    const error = new EmailSendError("smtp_ETIMEDOUT", { permanent: false });
    w.sender.failNext(error);

    await expect(run("invitation", invitationId, 2)).rejects.toBe(error);

    expect((await invitationRow(invitationId))["send_failed_at"]).toBeNull();
    expect(failed()).toEqual([]);
  });
});

describe("TP-0.17x: invitation email details", () => {
  it("TP-0.17x: an invitation whose expiry has passed is skipped", async () => {
    const inviter = await userFactory(h);
    const { invitationId } = await invitationFactory(h, {
      email: "late@example.com",
      now: NOW,
      inviterUserId: inviter.id,
      expiresAt: NOW,
    });

    await run("invitation", invitationId);

    expect(w.sender.sent).toEqual([]);
  });

  it('TP-0.17x: without an inviter the subject is "Your Budmon invitation"', async () => {
    const { invitationId } = await invitationFactory(h, {
      email: "boot@example.com",
      now: NOW,
      origin: "bootstrap",
    });

    await run("invitation", invitationId);

    expect(w.sender.sent[0]?.subject).toBe("Your Budmon invitation");
  });

  it("TP-0.17x: a successful send counts identity_emails_total{error_key=none}", async () => {
    const { invitationId } = await pendingInvitation();

    await run("invitation", invitationId);

    expect(metrics.emails.add).toHaveBeenCalledWith(1, { error_key: "none" });
  });

  it("TP-0.17x: the html carries the same link, and the plain token isn't stored anywhere", async () => {
    const { invitationId } = await pendingInvitation();

    await run("invitation", invitationId);

    const sent = w.sender.sent[0];
    const token = linkToken(sent?.text ?? "", "/invite");
    expect(sent?.html).toContain(`href="${ORIGIN}/invite#t=${token}"`);
    const { rows } = await h.executeSql("SELECT row_to_json(i)::text AS j FROM invitations i");
    expect(rows.map((r) => String(r["j"])).join()).not.toContain(token);
  });
});

describe("TP-0.18: the password reset email job", () => {
  it("TP-0.18: a user with a password gets password_reset; one without gets password_set", async () => {
    const withPassword = await userFactory(h);
    await passwordFactory(h, withPassword.id);
    const googleOnly = await userFactory(h);
    const a = await resetFactory(h, { userId: withPassword.id, now: NOW });
    const b = await resetFactory(h, { userId: googleOnly.id, now: NOW });

    await run("password_reset", a.resetId);
    await run("password_reset", b.resetId);

    expect(w.sender.sent.map((m) => [m.to, m.subject])).toEqual([
      [withPassword.email, "Reset your Budmon password"],
      [googleOnly.email, "Set a password for Budmon"],
    ]);
  });

  it("TP-0.18: a used reset is skipped", async () => {
    const user = await userFactory(h);
    await passwordFactory(h, user.id);
    const used = await resetFactory(h, { userId: user.id, now: NOW, usedAt: NOW });

    await run("password_reset", used.resetId);

    expect(w.sender.sent).toEqual([]);
  });
});

describe("TP-0.18x: reset email details", () => {
  it("TP-0.18x: the link is <origin>/reset-password#t=bmp_… and its hash is stored on the reset", async () => {
    const user = await userFactory(h);
    await passwordFactory(h, user.id);
    const { resetId } = await resetFactory(h, { userId: user.id, now: NOW });

    await run("password_reset", resetId);

    const token = linkToken(w.sender.sent[0]?.text ?? "", "/reset-password");
    expect(token.startsWith("bmp_")).toBe(true);
    const { rows } = await h.executeSql("SELECT token_hash FROM password_resets WHERE id = $1", [
      resetId,
    ]);
    expect((rows[0]?.["token_hash"] as Buffer).equals(hashToken(token))).toBe(true);
  });

  it("TP-0.18x: an expired reset is skipped", async () => {
    const user = await userFactory(h);
    const { resetId } = await resetFactory(h, { userId: user.id, now: NOW, expiresAt: NOW });

    await run("password_reset", resetId);

    expect(w.sender.sent).toEqual([]);
  });

  it("TP-0.18x: a user closed by the owner is skipped; one who asked for deletion still gets it", async () => {
    const pending = (by: "owner" | "self") =>
      userFactory(h, {
        status: "pending_deletion",
        deletionRequestedAt: new Date(NOW.epochMilliseconds),
        deletionScheduledFor: new Date(NOW.add({ hours: 168 }).epochMilliseconds),
        deletionRequestedBy: by,
      });
    const closed = await pending("owner");
    const leaving = await pending("self");
    const a = await resetFactory(h, { userId: closed.id, now: NOW });
    const b = await resetFactory(h, { userId: leaving.id, now: NOW });

    await run("password_reset", a.resetId);
    await run("password_reset", b.resetId);

    expect(w.sender.sent.map((m) => m.to)).toEqual([leaving.email]);
  });
});
