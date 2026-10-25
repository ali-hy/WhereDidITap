// F-194: a Sentry envelope sink for the rehearsal. It stores each envelope's raw body for F-198's
// scan and answers 200; HTTPS when `tls` is given (A-443), so SENTRY_DSN can be a valid https:// DSN.
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { gunzipSync } from "node:zlib";
import { closeServer, listen, readRaw, sendJson } from "./serve.js";

const ENVELOPE = /^\/api\/[^/]+\/envelope\/?$/;

export function startSentryCapture(
  port: number,
  tls?: { key: Buffer; cert: Buffer },
): Promise<{ events(): string[]; close(): Promise<void> }> {
  const events: string[] = [];

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = await readRaw(req);
    const pathname = new URL(req.url ?? "/", "http://sentry.invalid").pathname;
    if (req.method !== "POST" || !ENVELOPE.test(pathname)) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    // The SDKs may gzip envelopes; store the text the scan can read.
    let body = raw;
    if (req.headers["content-encoding"] === "gzip") {
      try {
        body = gunzipSync(raw);
      } catch {
        body = raw;
      }
    }
    events.push(body.toString("utf8"));
    sendJson(res, 200, {});
  };

  const listener = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => {
      sendJson(res, 500, { error: "capture_failed" });
    });
  };
  const server =
    tls === undefined
      ? createHttpServer(listener)
      : createHttpsServer({ key: tls.key, cert: tls.cert }, listener);
  return (async () => {
    await listen(server, port, "0.0.0.0");
    return {
      events: () => [...events],
      close: () => closeServer(server),
    };
  })();
}
