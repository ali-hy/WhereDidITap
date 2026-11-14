// F-31 renderEmail and §7.2's server catalog additions (identity LLD §4.1, §7.2). TP-0.16, plus
// extra cases TP-0.16x. The name is `{appName}`, which F-31 sets to F-1's APP_NAME (A-23, A-26).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/i18n/render.js";
import en from "../../../src/i18n/messages/en.json" with { type: "json" };
import { renderEmail, type EmailContent } from "../../../src/identity/emailTemplates.js";

const APP = "wDit";
const ISOLATES = /[⁦-⁩]/g;
const strip = (s: string): string => s.replace(ISOLATES, "");
const TOKEN = "bmi_Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789-_a";
const URL_ = `https://x.ts.net/invite#t=${TOKEN}`;

function invitation(inviter = "Ahmed", url = URL_): EmailContent {
  return {
    subjectId: "email.invitation.subject",
    introId: "email.invitation.intro",
    outroId: "email.invitation.outro",
    values: { inviter, email: "mona@example.com", contextLine: "", date: "Nov 9, 2026" },
    link: { url, buttonId: "email.invitation.button" },
  };
}

describe("TP-0.16: renderEmail (invitation)", () => {
  it('TP-0.16: the subject is exactly "Ahmed invited you to wDit", with no U+2066 to U+2069', () => {
    const { subject } = renderEmail(invitation(), "en");

    expect(subject).toBe("Ahmed invited you to wDit");
    expect(subject).not.toMatch(ISOLATES);
  });

  it("TP-0.16 (A-23, A-26): a caller's appName value is ignored; F-1's APP_NAME is used", () => {
    const c = invitation();
    c.values = { ...c.values, appName: "Evil Corp" };

    const { subject, text, html } = renderEmail(c, "en");

    expect(subject).toBe("Ahmed invited you to wDit");
    expect(strip(text)).toContain("to wDit, an app for keeping track of your money.");
    expect(text).not.toContain("Evil Corp");
    expect(html).not.toContain("Evil Corp");
  });

  it("TP-0.16: the text body keeps the isolates around values and has the URL on its own line, with no isolate around or inside it", () => {
    const { text } = renderEmail(invitation(), "en");

    expect(text).toContain("⁨Ahmed⁩");
    const lines = text.split("\n");
    expect(lines).toContain(URL_);
    const urlLine = lines.find((l) => l.includes("x.ts.net")) ?? "";
    expect(urlLine).toBe(URL_);
    expect(urlLine).not.toMatch(ISOLATES);
  });

  it("TP-0.16: text is intro, blank line, URL, blank line, outro", () => {
    const c = invitation();

    const { text } = renderEmail(c, "en");

    const values = { ...c.values, appName: APP };
    expect(text).toBe(
      `${renderMessage("en", c.introId, values)}\n\n${URL_}\n\n${renderMessage("en", c.outroId ?? "", values)}`,
    );
  });

  it("TP-0.16: the HTML has exactly one <a href> with the verbatim URL, and escaped text", () => {
    const { html } = renderEmail(invitation("Ahmed <b>&</b>"), "en");

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`<a href="${URL_}">`);
    expect(html).toContain("Accept invitation</a>");
    expect(html).toContain("Ahmed &lt;b&gt;&amp;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it('TP-0.16: with locale ar-XB the document is <html lang="ar-XB" dir="rtl">', () => {
    const { html } = renderEmail(invitation(), "ar-XB");

    expect(html.startsWith('<!doctype html><html lang="ar-XB" dir="rtl"><body>')).toBe(true);
    expect(html.endsWith("</body></html>")).toBe(true);
  });
});

describe("TP-0.16x: renderEmail structure", () => {
  it('TP-0.16x: English is <html lang="en" dir="ltr">, with the intro and outro each in <p>', () => {
    const c = invitation();

    const { html } = renderEmail(c, "en");

    expect(html.startsWith('<!doctype html><html lang="en" dir="ltr"><body>')).toBe(true);
    expect(html).toContain(`<p><a href="${URL_}">Accept invitation</a></p>`);
    expect(html.match(/<p>/g)?.length).toBe(3);
  });

  it("TP-0.16x: the link URL is attribute-escaped in the HTML and verbatim in the text", () => {
    const url = "https://x.ts.net/reset-password#t=bmp_x&y";

    const { html, text } = renderEmail(invitation("Ahmed", url), "en");

    expect(html).toContain('<a href="https://x.ts.net/reset-password#t=bmp_x&amp;y">');
    expect(text.split("\n")).toContain(url);
  });

  it("TP-0.16x: content without a link or an outro is the intro alone, with no <a>", () => {
    const c: EmailContent = {
      subjectId: "email.deletion_cancelled.subject",
      introId: "email.deletion_cancelled.intro",
      values: {},
    };

    const { text, html, subject } = renderEmail(c, "en");

    expect(subject).toBe("Your wDit account won't be deleted");
    expect(text).toBe("Your account won't be deleted. Reconnect your Gmail and SMS in Sources.");
    expect(html).not.toContain("<a ");
  });

  it("TP-0.16x: a one-paragraph intro is one escaped <p>", () => {
    const c: EmailContent = {
      subjectId: "email.account_deleted.subject",
      introId: "email.account_deleted.intro",
      values: {},
    };

    const { html } = renderEmail(c, "en");

    expect(html).toContain(
      "<p>Everything you owned in wDit has been erased. Copies in backups are gone within 14 days.</p>",
    );
  });

  it("TP-0.16x: an unknown message ID throws", () => {
    expect(() =>
      renderEmail(
        { subjectId: "email.nope.subject", introId: "email.nope.intro", values: {} },
        "en",
      ),
    ).toThrow();
  });
});

const EMAIL_KINDS_WITH_LINK = [
  "invitation",
  "password_reset",
  "password_set",
  "password_changed",
  "password_added",
  "two_step_enabled",
  "two_step_disabled",
  "authenticator_replaced",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "two_step_failed",
  "google_linked",
  "google_unlinked",
  "two_step_reset_by_owner",
  "session_reuse_signed_out",
  "export_ready",
  "deletion_scheduled",
];
const EMAIL_KINDS_WITHOUT_LINK = [
  "deletion_cancelled",
  "account_closed_owner",
  "account_closed_ban",
  "account_deleted",
  "invitation_cap_failed",
];
const SECURITY_KINDS = [
  "password_changed",
  "password_added",
  "two_step_enabled",
  "two_step_disabled",
  "authenticator_replaced",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "two_step_failed",
  "google_linked",
  "google_unlinked",
];
const catalog = en as Record<string, string>;

/** renderMessage in English without the isolates, with appName as F-31 sets it. */
const english = (id: string, values: Record<string, string> = {}): string =>
  strip(renderMessage("en", id, { ...values, appName: APP }));

describe("TP-0.16x: §7.2's server catalog", () => {
  it.each([...EMAIL_KINDS_WITH_LINK, ...EMAIL_KINDS_WITHOUT_LINK])(
    "TP-0.16x: %s has its subject and intro",
    (kind) => {
      expect(catalog[`email.${kind}.subject`]).toBeTypeOf("string");
      expect(catalog[`email.${kind}.intro`]).toBeTypeOf("string");
    },
  );

  it.each(EMAIL_KINDS_WITH_LINK)("TP-0.16x: %s has a button", (kind) => {
    expect(catalog[`email.${kind}.button`]).toBeTypeOf("string");
  });

  it.each(EMAIL_KINDS_WITHOUT_LINK)("TP-0.16x: %s has no button", (kind) => {
    expect(catalog[`email.${kind}.button`]).toBeUndefined();
  });

  it.each(SECURITY_KINDS)("TP-0.16x: %s has the shared outro and button text", (kind) => {
    expect(english(`email.${kind}.outro`)).toBe(
      "If this wasn't you, change your password and review your security settings.",
    );
    expect(english(`email.${kind}.button`)).toBe("Review your security settings");
  });

  // HLD §4.9's subjects for the kinds dated by their security event (A-26).
  it.each([
    ["password_changed", "Your wDit password was changed"],
    ["password_added", "A password was added to your wDit account"],
    ["two_step_enabled", "Two-step verification was turned on"],
    ["two_step_disabled", "Two-step verification was turned off"],
    ["authenticator_replaced", "Your two-step verification app was changed"],
    ["recovery_codes_regenerated", "New recovery codes were created"],
    ["recovery_code_used", "A recovery code was used to sign in"],
    ["two_step_failed", "Someone tried to sign in to wDit and didn't pass two-step verification"],
    ["google_linked", "Google sign-in was connected to your wDit account"],
    ["google_unlinked", "Google sign-in was disconnected from your wDit account"],
  ])("TP-0.16x (A-26): email.%s.subject is %j", (kind, subject) => {
    expect(english(`email.${kind}.subject`)).toBe(subject);
  });

  it("TP-0.16x (A-23, A-26): no message holds the name literally; it comes only from {appName}", () => {
    const literal = Object.entries(catalog)
      .filter(([, text]) => /budmon|wdit/i.test(text))
      .map(([id]) => id);
    expect(literal).toEqual([]);
    expect(catalog["email.invitation.subject"]).toContain("{appName}");
  });

  // A-11: the event sentence of each "{event} on {date}." kind; two_step_failed has none.
  it.each([
    ["password_changed", "Your password was changed"],
    ["password_added", "A password was added to your account"],
    ["two_step_enabled", "Two-step verification was turned on"],
    ["two_step_disabled", "Two-step verification was turned off"],
    ["authenticator_replaced", "Your two-step verification app was changed"],
    ["recovery_codes_regenerated", "New recovery codes were created"],
    ["recovery_code_used", "A recovery code was used to sign in"],
    ["google_linked", "Google sign-in was connected to your account"],
    ["google_unlinked", "Google sign-in was disconnected from your account"],
  ])("TP-0.16x (A-11): email.%s.event is %j", (kind, text) => {
    expect(english(`email.${kind}.event`)).toBe(text);
  });

  it("TP-0.16x (A-11): two_step_failed has no event message", () => {
    expect(catalog["email.two_step_failed.event"]).toBeUndefined();
  });

  it.each(SECURITY_KINDS.filter((k) => k !== "two_step_failed"))(
    'TP-0.16x: %s intro is "{event} on {date}."',
    (kind) => {
      expect(english(`email.${kind}.intro`, { event: "EVENT", date: "DATE" })).toBe(
        "EVENT on DATE.",
      );
    },
  );

  it.each([
    ["email.invitation.subject", { inviter: "I" }, "I invited you to wDit"],
    [
      "email.invitation.intro",
      { inviter: "I", email: "E", contextLine: " C" },
      "I invited E to wDit, an app for keeping track of your money. C",
    ],
    ["email.invitation.outro", { date: "D" }, "This invitation expires on D."],
    ["email.invitation.button", {}, "Accept invitation"],
    ["email.invitation.subjectNoInviter", {}, "Your wDit invitation"],
    ["email.invitation.introNoInviter", { email: "E" }, "You've been invited to wDit as E."],
    ["email.password_reset.subject", {}, "Reset your wDit password"],
    ["email.password_reset.intro", { email: "E" }, "Someone asked to reset the password for E."],
    [
      "email.password_reset.outro",
      {},
      "This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.",
    ],
    ["email.password_reset.button", {}, "Choose a new password"],
    ["email.password_set.subject", {}, "Set a password for wDit"],
    [
      "email.password_set.intro",
      {},
      "Your account uses Google sign-in. You can also set a password.",
    ],
    [
      "email.password_set.outro",
      {},
      "This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.",
    ],
    ["email.password_set.button", {}, "Set a password"],
    [
      "email.two_step_failed.intro",
      { date: "D" },
      "Someone got past the first sign-in step for your account but not your two-step code, on D.",
    ],
    [
      "email.two_step_reset_by_owner.subject",
      {},
      "Two-step verification was turned off by the administrator",
    ],
    [
      "email.two_step_reset_by_owner.intro",
      { email: "E", date: "D" },
      "The wDit administrator turned off two-step verification for E on D.",
    ],
    [
      "email.two_step_reset_by_owner.outro",
      {},
      "If you didn't ask for this, contact the administrator now.",
    ],
    ["email.session_reuse_signed_out.subject", { device: "V" }, "We signed you out of wDit on V"],
    [
      "email.session_reuse_signed_out.intro",
      { device: "V", date: "D" },
      "For your security, we signed V out on D, because its sign-in was used twice.",
    ],
    ["email.session_reuse_signed_out.outro", {}, "If that was you, sign in again on that device."],
    ["email.export_ready.subject", {}, "Your wDit export is ready"],
    ["email.export_ready.intro", { date: "D" }, "Your export is ready. Download it before D."],
    ["email.export_ready.button", {}, "Go to your data"],
    ["email.deletion_scheduled.subject", { date: "D" }, "Your wDit account will be deleted on D"],
    [
      "email.deletion_scheduled.intro",
      { date: "D" },
      "Your account and everything you own in wDit will be erased on D.",
    ],
    [
      "email.deletion_scheduled.outro",
      {},
      "Sign in before then to keep your account or to download your data.",
    ],
    ["email.deletion_scheduled.button", {}, "Sign in"],
    ["email.deletion_cancelled.subject", {}, "Your wDit account won't be deleted"],
    ["email.account_closed_owner.subject", {}, "Your wDit account has been closed"],
    [
      "email.account_closed_owner.intro",
      { now: "N", date: "D" },
      "The wDit administrator closed your account on N. Your data will be erased on D.",
    ],
    ["email.account_closed_ban.subject", {}, "Your wDit account has been closed"],
    [
      "email.account_closed_ban.intro",
      {},
      "The wDit administrator closed your account. Your data has been erased.",
    ],
    ["email.account_deleted.subject", {}, "Your wDit account has been deleted"],
    ["email.invitation_cap_failed.subject", { email: "E" }, "E couldn't join wDit"],
    [
      "email.invitation_cap_failed.intro",
      { email: "E" },
      "wDit has reached its user limit, so E couldn't create an account. The administrator has been told.",
    ],
  ])("TP-0.16x: %s renders §7.2's English", (id, values, expected) => {
    expect(english(id, values as Record<string, string>)).toBe(expected);
  });
});
