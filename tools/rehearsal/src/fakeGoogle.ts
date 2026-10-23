// F-196: the rehearsal's fake Google (A-24, A-441, A-443). One HTTPS server answering by Host
// (Gmail tokens, the sign-in token with an RS256 id_token, the JWKS, Gmail reads, Pub/Sub), and a
// plain-HTTP control on 127.0.0.1 that switches the Gmail token branch's answer.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Canaries } from "@budmon/test-support";
import { closeServer, listen, readBody, sendJson, sendText } from "./serve.js";

export const FAKE_SIGNIN_KID = "fake-signin-1";

const MODES = ["ok", "invalid_grant", "server_error", "gaxios_error"] as const;
type Mode = (typeof MODES)[number];

/** A-24: RSA-2048 from node:crypto, one per run. */
export function generateSignInKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

/** A-24: "signin." + base64url(UTF-8 nonce). */
export function fakeSignInCode(nonce: string): string {
  return `signin.${Buffer.from(nonce, "utf8").toString("base64url")}`;
}

const SIGNIN_CODE = /^signin\.([A-Za-z0-9_-]{1,512})$/;

/** The nonce a sign-in code carries, or null when the code is malformed. */
function nonceOf(code: string | null): string | null {
  const match = SIGNIN_CODE.exec(code ?? "");
  if (match === null) return null;
  const bytes = Buffer.from(match[1] ?? "", "base64url");
  // Strict: the group must round-trip as base64url and decode to valid, non-empty UTF-8.
  if (bytes.toString("base64url") !== match[1]) return null;
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    const text = utf8.decode(bytes);
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

function idToken(
  keyPair: { privateKey: KeyObject },
  clientId: string,
  canaries: Canaries,
  nonce: string,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const part = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${part({ alg: "RS256", kid: FAKE_SIGNIN_KID, typ: "JWT" })}.${part({
    iss: "https://accounts.google.com",
    aud: clientId,
    azp: clientId,
    sub: "canary-sub-7f3a",
    email: canaries.email,
    email_verified: true,
    name: "Canary User",
    iat,
    exp: iat + 3600,
    nonce,
  })}`;
  const signature = sign("sha256", Buffer.from(signingInput), keyPair.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function startFakeGoogle(opts: {
  tls: { key: Buffer; cert: Buffer };
  port: number;
  controlPort: number;
  canaries: Canaries;
  signInClientId: string;
  signInKeyPair: { privateKey: KeyObject; publicKey: KeyObject };
}): Promise<{ close(): Promise<void> }> {
  const { canaries } = opts;
  let mode: Mode = "ok";
  const jwk = opts.signInKeyPair.publicKey.export({ format: "jwk" });

  const gmailToken = (res: ServerResponse): void => {
    switch (mode) {
      case "ok":
        sendJson(res, 200, {
          access_token: canaries.token,
          refresh_token: `${canaries.token}-r`,
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        });
        return;
      case "invalid_grant":
        sendJson(res, 400, { error: "invalid_grant", error_description: canaries.message });
        return;
      case "server_error":
        sendJson(res, 500, { error: "server_error", error_description: canaries.token });
        return;
      case "gaxios_error":
        sendText(
          res,
          502,
          "text/html; charset=utf-8",
          `<html><body>upstream error ${canaries.token} ${canaries.message}</body></html>`,
        );
        return;
    }
  };

  const gmailMessage = (id: string) => ({
    id,
    threadId: id,
    historyId: "1",
    internalDate: String(Date.now()),
    snippet: canaries.message,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: `${canaries.payee} <${canaries.email}>` },
        { name: "Subject", value: canaries.payee },
      ],
      body: { data: Buffer.from(canaries.message, "utf8").toString("base64url") },
    },
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    const url = new URL(req.url ?? "/", "https://fake.invalid");
    const body = await readBody(req);
    if (host === "oauth2.googleapis.com" && req.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("client_id") === opts.signInClientId) {
        const nonce = nonceOf(form.get("code"));
        if (nonce === null) {
          sendJson(res, 400, { error: "invalid_grant" });
          return;
        }
        sendJson(res, 200, {
          access_token: canaries.token,
          id_token: idToken(opts.signInKeyPair, opts.signInClientId, canaries, nonce),
          expires_in: 3599,
          token_type: "Bearer",
          scope: "openid email profile",
        });
        return;
      }
      gmailToken(res);
      return;
    }
    if (
      host === "www.googleapis.com" &&
      req.method === "GET" &&
      url.pathname === "/oauth2/v3/certs"
    ) {
      sendJson(res, 200, {
        keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid: FAKE_SIGNIN_KID, alg: "RS256", use: "sig" }],
      });
      return;
    }
    if (host === "gmail.googleapis.com" && req.method === "GET") {
      if (url.pathname === "/gmail/v1/users/me/history") {
        sendJson(res, 200, {
          history: [
            { id: "2", messagesAdded: [{ message: { id: "canary-1", threadId: "canary-1" } }] },
          ],
          historyId: "2",
        });
        return;
      }
      const message = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(url.pathname);
      if (message !== null) {
        sendJson(res, 200, gmailMessage(decodeURIComponent(message[1] ?? "")));
        return;
      }
    }
    if (host === "pubsub.googleapis.com") {
      sendJson(res, 503, { error: { code: 503, status: "UNAVAILABLE" } });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  };

  const controlHandle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req);
    if (req.method !== "POST" || (req.url ?? "") !== "/__control") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    let next: unknown;
    try {
      next = (JSON.parse(body) as { mode?: unknown } | null)?.mode;
    } catch {
      next = undefined;
    }
    if (!MODES.includes(next as Mode)) {
      sendJson(res, 400, { error: "invalid_mode" });
      return;
    }
    mode = next as Mode;
    sendJson(res, 200, { mode });
  };

  const server = createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, (req, res) => {
    handle(req, res).catch(() => {
      sendJson(res, 500, { error: "fake_failed" });
    });
  });
  const control = createHttpServer((req, res) => {
    controlHandle(req, res).catch(() => {
      sendJson(res, 500, { error: "fake_failed" });
    });
  });
  return (async () => {
    await listen(server, opts.port, "0.0.0.0");
    try {
      await listen(control, opts.controlPort, "127.0.0.1");
    } catch (error) {
      await closeServer(server);
      throw error;
    }
    return {
      close: async () => {
        await Promise.all([closeServer(server), closeServer(control)]);
      },
    };
  })();
}
