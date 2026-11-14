// F-32: the identity.email-send job. Tokens are issued here, in the worker, so a plain token
// exists only in memory and in the email.
import { renderMessage } from "../i18n/render.js";
import { withTransaction } from "../platform/db/transaction.js";
import type { JobContext } from "../platform/queue/wrapper.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { PSEUDO_LOCALES, type SecurityEventKind } from "./constants.js";
import { renderEmail, type EmailContent, type EmailKind } from "./emailTemplates.js";
import { EmailSendError } from "./emailSender.js";
import * as exportsRepo from "./exportsRepo.js";
import { identityJobs } from "./identityJobs.js";
import type { IdentityDeps } from "./identityModule.js";
import * as invitationsRepo from "./invitationsRepo.js";
import * as resetsRepo from "./resetsRepo.js";
import * as securityEventsRepo from "./securityEventsRepo.js";
import * as sessionsRepo from "./sessionsRepo.js";
import { generateToken, hashToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";
import type { UserRow } from "./usersRepo.js";

export interface EmailSendPayload {
  kind: EmailKind;
  refId: string;
  recipient?: "inviter" | "owner";
}

/** One email to send. */
interface Message {
  to: string;
  locale: string;
  content: EmailContent;
}

const SECURITY_EVENT_OF: Partial<Record<EmailKind, SecurityEventKind>> = {
  password_changed: "password_changed",
  password_added: "password_added",
  two_step_enabled: "two_step_enabled",
  two_step_disabled: "two_step_disabled",
  two_step_reset_by_owner: "two_step_reset_by_owner",
  authenticator_replaced: "authenticator_replaced",
  recovery_codes_regenerated: "recovery_codes_regenerated",
  recovery_code_used: "recovery_code_used",
  two_step_failed: "two_step_failed_sign_in",
  google_linked: "google_linked",
  google_unlinked: "google_unlinked",
};

/** Dates in the recipient's locale and zone; pseudo-locales format as English. */
function formatDate(at: Date, locale: string, timeZone: string, withTime: boolean): string {
  const tag = PSEUDO_LOCALES.includes(locale) ? "en" : locale;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone,
  };
  try {
    return new Intl.DateTimeFormat(tag, options).format(at);
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(at);
  }
}

const isClosed = (user: UserRow): boolean =>
  user.status === "pending_deletion" && user.deletionRequestedBy !== "self";

function userMessage(user: UserRow, content: EmailContent): Message {
  return { to: user.email, locale: user.locale, content };
}

/** The content a kind sends to a user, per §7.2. */
function userContent(
  kind: EmailKind,
  user: UserRow,
  origin: string,
  eventAt: Date,
): EmailContent | null {
  const security = `${origin}/settings/security`;
  const date = formatDate(eventAt, user.locale, user.timeZone, true);
  switch (kind) {
    case "password_changed":
    case "password_added":
    case "two_step_enabled":
    case "two_step_disabled":
    case "authenticator_replaced":
    case "recovery_codes_regenerated":
    case "recovery_code_used":
    case "google_linked":
    case "google_unlinked":
      return {
        subjectId: `email.${kind}.subject`,
        introId: `email.${kind}.intro`,
        outroId: `email.${kind}.outro`,
        values: { event: eventLabel(kind, user.locale), date },
        link: { url: security, buttonId: `email.${kind}.button` },
      };
    case "two_step_failed":
      return {
        subjectId: "email.two_step_failed.subject",
        introId: "email.two_step_failed.intro",
        outroId: "email.two_step_failed.outro",
        values: { date },
        link: { url: security, buttonId: "email.two_step_failed.button" },
      };
    case "two_step_reset_by_owner":
      return {
        subjectId: "email.two_step_reset_by_owner.subject",
        introId: "email.two_step_reset_by_owner.intro",
        outroId: "email.two_step_reset_by_owner.outro",
        values: { email: user.email, date },
        link: { url: security, buttonId: "email.two_step_reset_by_owner.button" },
      };
    case "deletion_scheduled": {
      const scheduled = user.deletionScheduledFor ?? eventAt;
      const scheduledDate = formatDate(scheduled, user.locale, user.timeZone, true);
      return {
        subjectId: "email.deletion_scheduled.subject",
        introId: "email.deletion_scheduled.intro",
        outroId: "email.deletion_scheduled.outro",
        values: { date: scheduledDate },
        link: { url: `${origin}/sign-in`, buttonId: "email.deletion_scheduled.button" },
      };
    }
    case "deletion_cancelled":
    case "account_closed_ban":
    case "account_deleted":
      return {
        subjectId: `email.${kind}.subject`,
        introId: `email.${kind}.intro`,
        values: {},
      };
    case "account_closed_owner":
      return {
        subjectId: "email.account_closed_owner.subject",
        introId: "email.account_closed_owner.intro",
        values: {
          now: formatDate(user.deletionRequestedAt ?? eventAt, user.locale, user.timeZone, true),
          date: formatDate(user.deletionScheduledFor ?? eventAt, user.locale, user.timeZone, true),
        },
      };
    default:
      return null;
  }
}

/** The event sentence is its own catalogue message, rendered once and passed to the intro. */
function eventLabel(kind: EmailKind, locale: string): string {
  return renderMessage(locale, `email.${kind}.event`);
}

export async function handleEmailSend(
  deps: IdentityDeps,
  payload: EmailSendPayload,
  ctx: JobContext,
): Promise<void> {
  const { sender, config } = deps;
  if (sender === null || config.email === undefined) {
    throw new Error("identity: sender unavailable");
  }
  const origin = config.email.publicOrigin.origin;
  const h = deps.database.handle;
  const now = deps.clock.now();
  const nowDate = new Date(now.epochMilliseconds);
  const { kind, refId } = payload;
  let invitationId = null as string | null;

  const message = await (async (): Promise<Message | null> => {
    switch (kind) {
      case "invitation": {
        const invitation = await invitationsRepo.findById(h, refId);
        if (
          invitation === null ||
          invitation.status !== "pending" ||
          invitation.expiresAt.getTime() <= now.epochMilliseconds
        ) {
          return null;
        }
        invitationId = invitation.id;
        const inviter =
          invitation.inviterUserId === null
            ? null
            : await usersRepo.findById(h, invitation.inviterUserId);
        const locale = inviter?.locale ?? "en";
        const zone = inviter?.timeZone ?? "UTC";
        const token = generateToken("invitation");
        await withTransaction(deps.database, (tx) =>
          invitationsRepo.setToken(tx, invitation.id, hashToken(token), nowDate, null),
        );
        const line = await deps.ports.invitationContext.contextLine(h, invitation.id, locale);
        const values = {
          email: invitation.email,
          contextLine: line === null ? "" : ` ${line}`,
          date: formatDate(invitation.expiresAt, locale, zone, false),
          ...(inviter === null ? {} : { inviter: inviter.displayName }),
        };
        return {
          to: invitation.email,
          locale,
          content: {
            subjectId:
              inviter === null ? "email.invitation.subjectNoInviter" : "email.invitation.subject",
            introId:
              inviter === null ? "email.invitation.introNoInviter" : "email.invitation.intro",
            outroId: "email.invitation.outro",
            values,
            link: { url: `${origin}/invite#t=${token}`, buttonId: "email.invitation.button" },
          },
        };
      }
      case "password_reset":
      case "password_set": {
        const reset = await resetsRepo.findById(h, refId);
        if (
          reset === null ||
          reset.usedAt !== null ||
          reset.invalidatedAt !== null ||
          reset.expiresAt.getTime() <= now.epochMilliseconds
        ) {
          return null;
        }
        const user = await usersRepo.findById(h, reset.userId);
        if (user === null || isClosed(user)) return null;
        const hasPassword = (await credentialsRepo.getPasswordHash(h, user.id)) !== null;
        const token = generateToken("reset");
        await withTransaction(deps.database, (tx) =>
          resetsRepo.setToken(tx, reset.id, hashToken(token)),
        );
        const id = hasPassword ? "password_reset" : "password_set";
        return userMessage(user, {
          subjectId: `email.${id}.subject`,
          introId: `email.${id}.intro`,
          outroId: `email.${id}.outro`,
          values: { email: user.email },
          link: { url: `${origin}/reset-password#t=${token}`, buttonId: `email.${id}.button` },
        });
      }
      case "invitation_cap_failed": {
        const invitation = await invitationsRepo.findById(h, refId);
        if (invitation === null) return null;
        const recipient =
          payload.recipient === "owner"
            ? await usersRepo.findOwner(h)
            : invitation.inviterUserId === null
              ? null
              : await usersRepo.findById(h, invitation.inviterUserId);
        if (recipient === null) return null;
        return userMessage(recipient, {
          subjectId: "email.invitation_cap_failed.subject",
          introId: "email.invitation_cap_failed.intro",
          values: { email: invitation.email },
        });
      }
      case "export_ready": {
        const export_ = await exportsRepo.findById(h, refId);
        if (export_ === null || export_.status !== "ready") return null;
        const user = await usersRepo.findById(h, export_.userId);
        if (user === null) return null;
        return userMessage(user, {
          subjectId: "email.export_ready.subject",
          introId: "email.export_ready.intro",
          values: {
            date: formatDate(export_.expiresAt ?? nowDate, user.locale, user.timeZone, false),
          },
          link: { url: `${origin}/settings/data`, buttonId: "email.export_ready.button" },
        });
      }
      case "session_reuse_signed_out": {
        const session = await sessionsRepo.findById(h, refId);
        if (session === null) return null;
        const user = await usersRepo.findById(h, session.userId);
        if (user === null) return null;
        return userMessage(user, {
          subjectId: "email.session_reuse_signed_out.subject",
          introId: "email.session_reuse_signed_out.intro",
          outroId: "email.session_reuse_signed_out.outro",
          values: {
            device: session.deviceLabel,
            date: formatDate(session.revokedAt ?? nowDate, user.locale, user.timeZone, true),
          },
          link: {
            url: `${origin}/settings/security`,
            buttonId: "email.session_reuse_signed_out.button",
          },
        });
      }
      default: {
        const user = await usersRepo.findById(h, refId);
        if (user === null) return null;
        const eventKind = SECURITY_EVENT_OF[kind];
        let eventAt = nowDate;
        if (eventKind !== undefined) {
          const events = await securityEventsRepo.listForUser(h, user.id, 50);
          eventAt = events.find((e) => e.kind === eventKind)?.createdAt ?? nowDate;
        }
        const content = userContent(kind, user, origin, eventAt);
        return content === null ? null : userMessage(user, content);
      }
    }
  })();

  if (message === null) {
    ctx.logger.info("email_skipped", { reason: kind });
    return;
  }

  try {
    await sender.send({ to: message.to, ...renderEmail(message.content, message.locale) });
  } catch (err) {
    if (err instanceof EmailSendError && err.permanent) {
      if (invitationId !== null) await invitationsRepo.markSendFailed(h, invitationId, nowDate);
      ctx.logger.warn("email_failed", { reason: kind, errorCode: err.message });
      deps.metrics.emails.add(1, { error_key: "EMAIL_PERMANENT" });
      return;
    }
    // Transient: the platform retries, and logs job_failed itself.
    if (invitationId !== null && ctx.attempt === identityJobs.emailSend.retryLimit + 1) {
      await invitationsRepo.markSendFailed(h, invitationId, nowDate);
    }
    throw err;
  }
  if (invitationId !== null) await invitationsRepo.markSent(h, invitationId, nowDate);
  deps.metrics.emails.add(1, { error_key: "none" });
}
