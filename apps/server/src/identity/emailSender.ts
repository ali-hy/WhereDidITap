// F-30: the email sender (SMTP through nodemailer, and an in-memory one for tests).
import nodemailer from "nodemailer";
import type { AppEnv, Config } from "../platform/config/schema.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** No `cause`: a Nodemailer error can hold recipient addresses (A-1). */
export class EmailSendError extends Error {
  readonly permanent: boolean;

  constructor(message: string, opts: { permanent: boolean }) {
    super(message);
    this.name = "EmailSendError";
    this.permanent = opts.permanent;
  }
}

export interface EmailSender {
  send(m: OutgoingEmail): Promise<void>;
}

export interface MemoryEmailSender extends EmailSender {
  readonly sent: readonly OutgoingEmail[];
  failNext(e: EmailSendError): void;
  clear(): void;
}

type EmailConfig = NonNullable<Config["email"]>;

/** Plain SMTP is allowed only to mailpit, or to localhost outside production and rehearsal. */
function plaintextAllowed(host: string, appEnv: AppEnv): boolean {
  if (host === "mailpit") return true;
  const local = host === "localhost" || host === "127.0.0.1";
  return local && (appEnv === "development" || appEnv === "test");
}

/** A token-safe code from a Nodemailer error: never an address. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "error";
}

function isPermanent(error: unknown): boolean {
  const responseCode = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof responseCode === "number" && responseCode >= 500;
}

export function createSmtpEmailSender(
  cfg: EmailConfig,
  appEnv: AppEnv,
  deps: { createTransport?: typeof nodemailer.createTransport | undefined } = {},
): EmailSender {
  const { security, host, port, user } = cfg.smtpTransport;
  if (security === "none" && !plaintextAllowed(host, appEnv)) {
    throw new EmailSendError("smtp_plaintext_refused", { permanent: true });
  }
  const createTransport = deps.createTransport ?? nodemailer.createTransport.bind(nodemailer);
  const transport = createTransport({
    host,
    port,
    ...(security === "implicit_tls"
      ? { secure: true }
      : security === "starttls"
        ? { secure: false, requireTLS: true }
        : { secure: false, ignoreTLS: true }),
    ...(cfg.smtpPassword === undefined
      ? {}
      : { auth: { user: user ?? "", pass: cfg.smtpPassword.reveal() } }),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
  });

  return {
    async send(m) {
      try {
        await transport.sendMail({
          from: cfg.from,
          to: m.to,
          subject: m.subject,
          text: m.text,
          html: m.html,
        });
      } catch (error) {
        throw new EmailSendError(`smtp_${codeOf(error)}`, { permanent: isPermanent(error) });
      }
    },
  };
}

export function createMemoryEmailSender(): MemoryEmailSender {
  const sent: OutgoingEmail[] = [];
  let failure: EmailSendError | null = null;
  return {
    get sent() {
      return sent;
    },
    send(m) {
      if (failure !== null) {
        const error = failure;
        failure = null;
        return Promise.reject(error);
      }
      sent.push(m);
      return Promise.resolve();
    },
    failNext(e) {
      failure = e;
    },
    clear() {
      sent.length = 0;
    },
  };
}
