// F-197: the rehearsal's fake FX (A-443). HTTPS on 0.0.0.0 serving the OXR, fawazahmed0 and mirror
// routes with F-133's fixed rates; a plain-HTTP control on 127.0.0.1 that makes a date (or every
// date) answer 500 with canaries, and counts requests per date.
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Canaries } from "@budmon/test-support";
import { closeServer, listen, readBody, sendJson, sendText } from "./serve.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OXR = /^\/oxr\/historical\/([^/]+)\.json$/;
const FAWAZ = /^\/(?:fawaz|mirror)\/([^/]+)\/currencies\/usd\.json$/;

// F-133's fixed rates, written as JSON numbers.
const OXR_BODY =
  '{"base":"USD","rates":{"USD":1,"EUR":0.92,"GBP":0.79,"EGP":48.5,"JPY":149.25,"KWD":0.307,"SAR":3.75}}';
const fawazBody = (date: string) =>
  `{"date":"${date}","usd":{"usd":1,"eur":0.92,"gbp":0.79,"egp":48.5,"jpy":149.25,"kwd":0.307,"sar":3.75}}`;

export function startFakeFx(opts: {
  tls: { key: Buffer; cert: Buffer };
  port: number;
  controlPort: number;
  canaries: Canaries;
}): Promise<{ close(): Promise<void> }> {
  const { canaries } = opts;
  let failing: { date: string | null } | null = null;
  const hits = new Map<string, number>();

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = new URL(req.url ?? "/", "https://fake.invalid").pathname;
    const oxr = req.method === "GET" ? OXR.exec(pathname) : null;
    const fawaz = req.method === "GET" ? FAWAZ.exec(pathname) : null;
    const date = (oxr ?? fawaz)?.[1];
    if (date === undefined || !DATE.test(date)) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    hits.set(date, (hits.get(date) ?? 0) + 1);
    if (failing !== null && (failing.date === null || failing.date === date)) {
      sendJson(res, 500, {
        error: "server_error",
        detail: `${canaries.message} ${canaries.token} ${canaries.email}`,
      });
      return;
    }
    sendText(res, 200, "application/json", oxr !== null ? OXR_BODY : fawazBody(date));
  };

  const controlHandle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://control.invalid");
    if (req.method === "POST" && url.pathname === "/__control" && url.search === "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      const { mode, date } = (typeof parsed === "object" && parsed !== null ? parsed : {}) as {
        mode?: unknown;
        date?: unknown;
      };
      const dateOk = date === undefined || (typeof date === "string" && DATE.test(date));
      if ((mode !== "ok" && mode !== "server_error") || !dateOk) {
        sendJson(res, 400, { error: "invalid_mode" });
        return;
      }
      failing = mode === "ok" ? null : { date: typeof date === "string" ? date : null };
      sendJson(res, 200, { mode, date: failing?.date ?? null });
      return;
    }
    if (req.method === "GET" && url.pathname === "/__control/hits") {
      const date = url.searchParams.get("date");
      if (date === null || !DATE.test(date)) {
        sendJson(res, 400, { error: "invalid_date" });
        return;
      }
      sendJson(res, 200, { date, count: hits.get(date) ?? 0 });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  };

  const server = createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, handle);
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
