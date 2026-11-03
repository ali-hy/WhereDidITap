// F-197 fake FX (A-443): the OXR, fawazahmed0 and mirror routes with F-133's fixed rates, the
// per-date server_error control and the hit counter. TP-16.18.
import { CANARIES } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JsonNumber,
  parseJsonKeepingNumberText,
} from "../../../apps/server/src/platform/fx/decimal.js";
import { loadFakeFx, type Closable } from "./support/load.js";
import { freePort, httpTo, httpsTo, json, selfSigned } from "./support/net.js";

const HOST = "fx.rehearsal.invalid";
const DATE = "2024-03-05";
const OTHER = "2024-03-06";
const OXR = { USD: 1, EUR: 0.92, GBP: 0.79, EGP: 48.5, JPY: 149.25, KWD: 0.307, SAR: 3.75 };
const FAWAZ = { usd: 1, eur: 0.92, gbp: 0.79, egp: 48.5, jpy: 149.25, kwd: 0.307, sar: 3.75 };

let fake: Closable | undefined;
let port = 0;
let controlPort = 0;
let cert: Buffer;

const get = (urlPath: string) => httpsTo(port, cert, HOST, "GET", urlPath);
const fawaz = (date: string) => get(`/fawaz/${date}/currencies/usd.json`);
const control = (body: unknown) => httpTo(controlPort, "POST", "/__control", json(body));
const hits = async (date: string) =>
  (
    JSON.parse((await httpTo(controlPort, "GET", `/__control/hits?date=${date}`)).body) as {
      count: number;
    }
  ).count;

beforeAll(async () => {
  const { startFakeFx } = await loadFakeFx();
  const tls = selfSigned([HOST]);
  cert = tls.cert;
  port = await freePort();
  controlPort = await freePort();
  fake = await startFakeFx({ tls, port, controlPort, canaries: CANARIES });
}, 60_000);

afterAll(async () => {
  await fake?.close();
});

/** Every number in `value` (as parsed by F-130) is a JsonNumber. */
function allJsonNumbers(value: unknown): boolean {
  if (value instanceof JsonNumber) return true;
  if (typeof value === "number") return false;
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(allJsonNumbers);
  }
  return true;
}

describe("TP-16.18: the rate routes (F-197)", () => {
  it("TP-16.18: /oxr/historical/<date>.json → OXR shape with F-133's rates (query ignored)", async () => {
    const r = await get(`/oxr/historical/${DATE}.json?app_id=x&base=USD`);

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ base: "USD", rates: OXR });
    const parsed = parseJsonKeepingNumberText(r.body) as { rates: Record<string, unknown> };
    expect(parsed.rates["EUR"]).toBeInstanceOf(JsonNumber);
    expect(allJsonNumbers(parsed)).toBe(true);
  });

  it.each(["fawaz", "mirror"])(
    "TP-16.18: /%s/<date>/currencies/usd.json → fawazahmed0 shape",
    async (prefix) => {
      const r = await get(`/${prefix}/${DATE}/currencies/usd.json`);

      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ date: DATE, usd: FAWAZ });
      const parsed = parseJsonKeepingNumberText(r.body) as { usd: Record<string, unknown> };
      expect(parsed.usd["kwd"]).toBeInstanceOf(JsonNumber);
      expect((parsed.usd["kwd"] as JsonNumber).source).toBe("0.307");
    },
  );

  it.each(["/fawaz/x/currencies/usd.json", "/nope"])("TP-16.18: %s → 404 not_found", async (p) => {
    const r = await get(p);

    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: "not_found" });
  });
});

describe("TP-16.18: control (A-443)", () => {
  it("TP-16.18: server_error for one date → 500 with the canaries for it, 200 for another", async () => {
    const c = await control({ mode: "server_error", date: DATE });
    const failing = await fawaz(DATE);
    const fine = await fawaz(OTHER);
    await control({ mode: "ok" });

    expect(c.status).toBe(200);
    expect(JSON.parse(c.body)).toEqual({ mode: "server_error", date: DATE });
    expect(failing.status).toBe(500);
    expect(JSON.parse(failing.body)).toEqual({
      error: "server_error",
      detail: `${CANARIES.message} ${CANARIES.token} ${CANARIES.email}`,
    });
    expect(fine.status).toBe(200);
  });

  it("TP-16.18: server_error with no date → every date fails; ok → 200 again with date null", async () => {
    const c = await control({ mode: "server_error" });
    const failing = await fawaz(OTHER);
    const okReply = await control({ mode: "ok" });
    const again = await fawaz(OTHER);

    expect(JSON.parse(c.body)).toEqual({ mode: "server_error", date: null });
    expect(failing.status).toBe(500);
    expect(okReply.status).toBe(200);
    expect(JSON.parse(okReply.body)).toEqual({ mode: "ok", date: null });
    expect(again.status).toBe(200);
  });

  it("TP-16.18: mode bogus, invalid JSON and a malformed date → 400 invalid_mode, state unchanged", async () => {
    await control({ mode: "ok" });
    const replies = [
      await control({ mode: "bogus" }),
      await httpTo(controlPort, "POST", "/__control", { type: "application/json", text: "{" }),
      await control({ mode: "server_error", date: "2024-3-5" }),
    ];

    for (const r of replies) {
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: "invalid_mode" });
    }
    expect((await fawaz(DATE)).status).toBe(200);
  });

  it("TP-16.18: hits count every request to the three routes for that date, whatever the mode", async () => {
    const before = await hits(DATE);
    await get(`/oxr/historical/${DATE}.json`);
    await fawaz(DATE);
    await control({ mode: "server_error", date: DATE });
    await get(`/mirror/${DATE}/currencies/usd.json`);
    await control({ mode: "ok" });
    await fawaz(OTHER);
    const r = await httpTo(controlPort, "GET", `/__control/hits?date=${DATE}`);

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ date: DATE, count: before + 3 });
  });

  it.each(["/__control/hits?date=x", "/__control/hits"])(
    "TP-16.18: GET %s → 400 invalid_date",
    async (p) => {
      const r = await httpTo(controlPort, "GET", p);

      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: "invalid_date" });
    },
  );

  it("TP-16.18: GET /__control/nope → 404 not_found", async () => {
    const r = await httpTo(controlPort, "GET", "/__control/nope");

    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: "not_found" });
  });
});
