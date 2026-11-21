// F-30 email sender (identity LLD §4.1, §7.2). TP-0.31, plus extra cases TP-0.31x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import type { Config } from "../../../src/platform/config/schema.js";
import { Secret } from "../../../src/platform/observability/redaction.js";
import {
  EmailSendError,
  createMemoryEmailSender,
  createSmtpEmailSender,
} from "../../../src/identity/emailSender.js";
import {
  devWorker,
  prodWorkerGeneral,
  readFileFrom,
  withFile,
  type Fixture,
} from "../../support/configEnv.js";

type EmailConfig = NonNullable<Config["email"]>;
type AppEnv = Config["appEnv"];

/** A fake nodemailer.createTransport that records its options. */
function recordingTransport(sendMail = vi.fn(() => Promise.resolve({}))) {
  const options: Record<string, unknown>[] = [];
  const createTransport = vi.fn((opts: Record<string, unknown>) => {
    options.push(opts);
    return { sendMail };
  });
  return {
    createTransport: createTransport as unknown as NonNullable<
      Parameters<typeof createSmtpEmailSender>[2]
    >["createTransport"],
    options,
    sendMail,
  };
}

/** Config["email"] parsed by the configuration (P-F-10) from a worker fixture with `SMTP_URL`. */
function emailConfig(
  fixture: () => Fixture,
  smtpUrl: string,
  appEnv?: AppEnv,
  password?: string,
): { email: EmailConfig; appEnv: AppEnv } {
  const f = fixture();
  f.env["SMTP_URL"] = smtpUrl;
  if (appEnv !== undefined) f.env["APP_ENV"] = appEnv;
  if (password !== undefined) withFile(f, "SMTP_PASSWORD_FILE", password);
  const config = loadConfig("worker", f.env, readFileFrom(f.files));
  if (config.email === undefined) throw new Error("fixture has no email config");
  return { email: config.email, appEnv: config.appEnv };
}

/** Builds the sender and returns the transport options it passed. */
function transportOptions(email: EmailConfig, appEnv: AppEnv): Record<string, unknown> {
  const t = recordingTransport();
  const sender = createSmtpEmailSender(email, appEnv, { createTransport: t.createTransport });
  expect(sender).toBeDefined();
  expect(t.options).toHaveLength(1);
  return t.options[0] as Record<string, unknown>;
}

function hand(security: "none", host: string): EmailConfig {
  return {
    smtpUrl: new URL(`smtp://${host}:25`),
    smtpTransport: { security, host, port: 25 },
    from: "Budmon <no-reply@budmon.example>",
    publicOrigin: new URL("https://a.ts.net"),
  };
}

function refused(email: EmailConfig, appEnv: AppEnv): unknown {
  const t = recordingTransport();
  try {
    createSmtpEmailSender(email, appEnv, { createTransport: t.createTransport });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("TP-0.31: the transport follows smtpTransport", () => {
  it("TP-0.31: smtps://u@smtp.example.com → secure: true, port 465", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com");

    expect(transportOptions(email, appEnv)).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
    });
  });

  it("TP-0.31: smtps://u@smtp.example.com:2465 → port 2465", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com:2465");

    expect(transportOptions(email, appEnv)).toMatchObject({ port: 2465, secure: true });
  });

  it("TP-0.31: smtp://u@smtp.example.com → requireTLS: true, port 587", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtp://u@smtp.example.com");

    expect(transportOptions(email, appEnv)).toMatchObject({
      port: 587,
      secure: false,
      requireTLS: true,
    });
  });

  it("TP-0.31: smtp://u@smtp.example.com:2525 → port 2525, requireTLS: true", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtp://u@smtp.example.com:2525");

    expect(transportOptions(email, appEnv)).toMatchObject({
      port: 2525,
      secure: false,
      requireTLS: true,
    });
  });

  it("TP-0.31: smtp://mailpit:1025 in production → ignoreTLS: true", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtp://mailpit:1025");
    expect(appEnv).toBe("production");

    expect(transportOptions(email, appEnv)).toMatchObject({
      host: "mailpit",
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
  });

  it.each(["development", "test"] as const)(
    "TP-0.31: smtp://localhost:1025 in %s → ignoreTLS: true",
    (env) => {
      const { email, appEnv } = emailConfig(devWorker, "smtp://localhost:1025", env);

      expect(transportOptions(email, appEnv)).toMatchObject({
        host: "localhost",
        secure: false,
        ignoreTLS: true,
      });
    },
  );

  it("TP-0.31: smtp://127.0.0.1:1025 in test → ignoreTLS: true", () => {
    const { email, appEnv } = emailConfig(devWorker, "smtp://127.0.0.1:1025", "test");

    expect(transportOptions(email, appEnv)).toMatchObject({ host: "127.0.0.1", ignoreTLS: true });
  });

  it.each(["production", "rehearsal"] as const)(
    "TP-0.31: a hand-built { security: none, host: localhost } in %s → EmailSendError(permanent, smtp_plaintext_refused)",
    (env) => {
      const error = refused(hand("none", "localhost"), env);

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error).toMatchObject({ permanent: true, message: "smtp_plaintext_refused" });
    },
  );

  it("TP-0.31: { security: none, host: smtp.example.com } in test → the same error", () => {
    const error = refused(hand("none", "smtp.example.com"), "test");

    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({ permanent: true, message: "smtp_plaintext_refused" });
  });

  it("TP-0.31: an empty password file → no auth.pass; a set one → auth.pass", () => {
    const empty = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com", undefined, "");
    const set = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com", undefined, "s3cret");

    const without = transportOptions(empty.email, empty.appEnv) as { auth?: { pass?: unknown } };
    const withPass = transportOptions(set.email, set.appEnv) as {
      auth?: { user?: unknown; pass?: unknown };
    };

    expect(without.auth?.pass).toBeUndefined();
    expect(withPass.auth).toMatchObject({ user: "u", pass: "s3cret" });
  });

  it("TP-0.31: user a%40b → auth.user a@b", () => {
    const { email, appEnv } = emailConfig(
      prodWorkerGeneral,
      "smtps://a%40b@smtp.example.com",
      undefined,
      "pw",
    );

    expect(transportOptions(email, appEnv)).toMatchObject({ auth: { user: "a@b", pass: "pw" } });
  });
});

describe("TP-0.31x: sender behaviour", () => {
  it("TP-0.31x: timeouts are 10 s, 10 s and 15 s, with logger and debug off", () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com");

    expect(transportOptions(email, appEnv)).toMatchObject({
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
    });
  });

  it("TP-0.31x: mailpit with security none is accepted in every appEnv (defence in depth allows it)", () => {
    for (const env of ["production", "rehearsal", "development", "test"] as const) {
      expect(refused(hand("none", "mailpit"), env)).toBeUndefined();
    }
  });

  it("TP-0.31x: send calls sendMail with from, to, subject, text and html", async () => {
    const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com");
    const t = recordingTransport();
    const sender = createSmtpEmailSender(email, appEnv, { createTransport: t.createTransport });

    await sender.send({ to: "mona@example.com", subject: "S", text: "T", html: "<p>H</p>" });

    expect(t.sendMail).toHaveBeenCalledWith({
      from: email.from,
      to: "mona@example.com",
      subject: "S",
      text: "T",
      html: "<p>H</p>",
    });
  });

  it.each([
    [
      "a 550 response",
      Object.assign(new Error("550 mailbox mona@example.com unavailable"), {
        responseCode: 550,
        code: "EENVELOPE",
      }),
      true,
      "smtp_EENVELOPE",
    ],
    [
      "a 500 response",
      Object.assign(new Error("500 x"), { responseCode: 500 }),
      true,
      "smtp_error",
    ],
    [
      "a 451 response",
      Object.assign(new Error("451 try later"), { responseCode: 451, code: "EMESSAGE" }),
      false,
      "smtp_EMESSAGE",
    ],
    [
      "an auth failure",
      Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }),
      true,
      "smtp_EAUTH",
    ],
    [
      "a connection error",
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" }),
      false,
      "smtp_ECONNECTION",
    ],
    ["a plain error", new Error("boom"), false, "smtp_error"],
  ])(
    "TP-0.31x: %s → EmailSendError(permanent %s) with message %s and no address",
    async (_l, err, permanent, message) => {
      const { email, appEnv } = emailConfig(prodWorkerGeneral, "smtps://u@smtp.example.com");
      const t = recordingTransport(vi.fn(() => Promise.reject(err)));
      const sender = createSmtpEmailSender(email, appEnv, { createTransport: t.createTransport });

      const error = await sender
        .send({ to: "mona@example.com", subject: "S", text: "T", html: "H" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error).toMatchObject({ permanent, message });
      expect((error as Error).message).not.toContain("@");
    },
  );

  it("TP-0.31x: the memory sender records in order, failNext throws once, clear empties", async () => {
    const sender = createMemoryEmailSender();
    const a = { to: "a@x.co", subject: "A", text: "a", html: "a" };
    const b = { to: "b@x.co", subject: "B", text: "b", html: "b" };
    const failure = new EmailSendError("smtp_ETIMEDOUT", { permanent: false });

    await sender.send(a);
    sender.failNext(failure);
    await expect(sender.send(b)).rejects.toBe(failure);
    await sender.send(b);

    expect(sender.sent).toEqual([a, b]);
    sender.clear();
    expect(sender.sent).toEqual([]);
  });

  it("TP-0.31x: EmailSendError(message, { permanent }) (A-1) has its name, message and flag", () => {
    const permanent = new EmailSendError("smtp_EENVELOPE", { permanent: true });
    const transient = new EmailSendError("smtp_ETIMEDOUT", { permanent: false });

    expect(permanent).toBeInstanceOf(Error);
    expect(permanent).toMatchObject({
      name: "EmailSendError",
      message: "smtp_EENVELOPE",
      permanent: true,
    });
    expect(transient.permanent).toBe(false);
  });

  it("TP-0.31x: the password comes from the Secret, never from the URL", () => {
    const { email, appEnv } = emailConfig(
      prodWorkerGeneral,
      "smtps://u@smtp.example.com",
      undefined,
      "pw",
    );

    expect(email.smtpPassword).toBeInstanceOf(Secret);
    expect(transportOptions(email, appEnv)).toMatchObject({ auth: { pass: "pw" } });
  });
});
