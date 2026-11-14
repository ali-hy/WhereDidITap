// F-31: email rendering. Values go through renderMessage (bidi-isolated); the link is inserted
// verbatim and never passes through a message.
import { directionOf } from "@budmon/shared";
import { renderMessage } from "../i18n/render.js";

export const EMAIL_KINDS = [
  "invitation",
  "password_reset",
  "password_set",
  "password_changed",
  "password_added",
  "two_step_enabled",
  "two_step_disabled",
  "two_step_reset_by_owner",
  "authenticator_replaced",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "two_step_failed",
  "google_linked",
  "google_unlinked",
  "session_reuse_signed_out",
  "export_ready",
  "deletion_scheduled",
  "deletion_cancelled",
  "account_closed_owner",
  "account_closed_ban",
  "account_deleted",
  "invitation_cap_failed",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailContent {
  subjectId: string;
  introId: string;
  outroId?: string;
  values: Record<string, string | number>;
  link?: { url: string; buttonId: string };
}

// U+2066 to U+2069: mail clients show them as stray characters in subject lines.
const ISOLATES = /[⁦-⁩]/g;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Blank-line separated paragraphs, each escaped and wrapped in <p>. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

export function renderEmail(
  c: EmailContent,
  locale: string,
): { subject: string; text: string; html: string } {
  const subject = renderMessage(locale, c.subjectId, c.values).replace(ISOLATES, "");
  const intro = renderMessage(locale, c.introId, c.values);
  const outro = c.outroId === undefined ? null : renderMessage(locale, c.outroId, c.values);

  const textParts = [intro];
  if (c.link !== undefined) textParts.push(c.link.url);
  if (outro !== null) textParts.push(outro);

  let html = `<!doctype html><html lang="${escapeHtml(locale)}" dir="${directionOf(locale)}"><body>`;
  html += paragraphs(intro);
  if (c.link !== undefined) {
    const button = escapeHtml(renderMessage(locale, c.link.buttonId));
    html += `<p><a href="${escapeHtml(c.link.url)}">${button}</a></p>`;
  }
  if (outro !== null) html += paragraphs(outro);
  html += "</body></html>";

  return { subject, text: textParts.join("\n\n"), html };
}
