// F-133 FX providers. TP-9.12 (Open Exchange Rates) and TP-9.13 (fawazahmed0), plus extra cases
// TP-9.24x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";
import {
  createFawazahmed0,
  createFixedProvider,
  createOpenExchangeRates,
  FxProviderError,
  type FxProviderErrorReason,
} from "../../../src/platform/fx/providers.js";

const DATE = "2026-10-04";
const APP_ID = "oxr-app-id-7f3a";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function urlOf(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}

async function failure(
  run: () => Promise<unknown>,
): Promise<Error & { reason?: FxProviderErrorReason; status?: number }> {
  try {
    await run();
  } catch (error) {
    return error as Error & { reason?: FxProviderErrorReason; status?: number };
  }
  throw new Error("expected fetchDay to fail");
}

describe("TP-9.12: Open Exchange Rates (F-133)", () => {
  function oxr(respond: () => Promise<Response>) {
    const fetchImpl = vi.fn<typeof fetch>(respond);
    const provider = createOpenExchangeRates(
      { baseUrl: new URL("https://oxr.example/api"), appId: Secret.of(APP_ID) },
      { fetch: fetchImpl },
    );
    return { provider, fetchImpl };
  }

  it("TP-9.12: 200 gives the rates as exact strings; the URL is /historical/<date>.json with app_id and base=USD", async () => {
    const { provider, fetchImpl } = oxr(() =>
      Promise.resolve(
        text(200, '{"base":"USD","rates":{"EGP":48.123456789012345,"EUR":0.92,"JPY":149.25}}'),
      ),
    );

    const rates = await provider.fetchDay(DATE, new AbortController().signal);

    expect(provider.name).toBe("openexchangerates");
    expect(rates).toEqual(
      new Map([
        ["EGP", "48.123456789012345"],
        ["EUR", "0.92"],
        ["JPY", "149.25"],
      ]),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    const url = urlOf(input ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`https://oxr.example/api/historical/${DATE}.json`);
    expect(url.searchParams.get("app_id")).toBe(APP_ID);
    expect(url.searchParams.get("base")).toBe("USD");
    expect(url.searchParams.get("show_alternative")).toBe("false");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  const cases: [string, () => Promise<Response>, FxProviderErrorReason, number | undefined][] = [
    [
      "base EUR",
      () => Promise.resolve(json(200, { base: "EUR", rates: { EGP: 1 } })),
      "invalid",
      undefined,
    ],
    [
      "a body without rates",
      () => Promise.resolve(json(200, { base: "USD" })),
      "invalid",
      undefined,
    ],
    [
      "a rate given as the string 0.92 (A-281)",
      () => Promise.resolve(text(200, '{"base":"USD","rates":{"EGP":48.5,"EUR":"0.92"}}')),
      "invalid",
      undefined,
    ],
    ["400", () => Promise.resolve(json(400, { error: true })), "not_found", undefined],
    ["404", () => Promise.resolve(json(404, { error: true })), "not_found", undefined],
    ["500", () => Promise.resolve(json(500, { error: true })), "http", 500],
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), "network", undefined],
  ];

  it.each(cases)("TP-9.12: %s is FxProviderError %s", async (_label, respond, reason, status) => {
    const { provider } = oxr(respond);

    const error = await failure(() => provider.fetchDay(DATE, new AbortController().signal));

    expect(error).toBeInstanceOf(FxProviderError);
    expect(error.reason).toBe(reason);
    // A-267: the name, the message, and status only for http.
    expect(error.name).toBe("FxProviderError");
    expect(error.status).toBe(status);
    expect(error.message).toBe(
      status === undefined ? `fx provider: ${reason}` : `fx provider: http ${String(status)}`,
    );
  });

  // "The logged URL has no query": the provider has no logger of its own (F-133 deps are
  // { fetch }), so what it hands back in errors must not carry the app_id either.
  it.each(cases)(
    "TP-9.12: %s: the error carries no app_id or query string",
    async (_label, respond) => {
      const { provider } = oxr(respond);

      const error = await failure(() => provider.fetchDay(DATE, new AbortController().signal));

      const all = JSON.stringify({
        ...Object.fromEntries(Object.entries(error)),
        message: error.message,
        stack: error.stack,
      });
      expect(all).not.toContain(APP_ID);
      expect(all).not.toContain("app_id");
    },
  );
});

describe("TP-9.13: fawazahmed0 (F-133)", () => {
  const BASE = "https://cdn.example/npm/@fawazahmed0/currency-api@{date}/v1";
  const MIRROR = "https://{date}.currency-api.example/v1";

  function fawaz(...responses: (() => Promise<Response>)[]) {
    let n = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      const respond = responses[Math.min(n, responses.length - 1)];
      n += 1;
      return respond === undefined ? Promise.reject(new Error("no response")) : respond();
    });
    const provider = createFawazahmed0({ baseUrl: BASE, mirrorUrl: MIRROR }, { fetch: fetchImpl });
    return { provider, fetchImpl };
  }

  const ok = () =>
    Promise.resolve(text(200, `{"date":"${DATE}","usd":{"egp":48.5,"eur":0.92,"jpy":149.25}}`));

  it("TP-9.13: primary 503 then mirror 200: the mirror is used and codes are upper-cased", async () => {
    const { provider, fetchImpl } = fawaz(() => Promise.resolve(json(503, {})), ok);

    const rates = await provider.fetchDay(DATE, new AbortController().signal);

    expect(provider.name).toBe("fawazahmed0");
    expect(rates).toEqual(
      new Map([
        ["EGP", "48.5"],
        ["EUR", "0.92"],
        ["JPY", "149.25"],
      ]),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchImpl.mock.calls[0]?.[0] ?? "").href).toBe(
      `https://cdn.example/npm/@fawazahmed0/currency-api@${DATE}/v1/currencies/usd.json`,
    );
    expect(urlOf(fetchImpl.mock.calls[1]?.[0] ?? "").href).toBe(
      `https://${DATE}.currency-api.example/v1/currencies/usd.json`,
    );
  });

  it("TP-9.24x: a primary network error also retries once on the mirror", async () => {
    const { provider, fetchImpl } = fawaz(() => Promise.reject(new TypeError("fetch failed")), ok);

    await provider.fetchDay(DATE, new AbortController().signal);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("TP-9.24x: a primary 200 doesn't touch the mirror", async () => {
    const { provider, fetchImpl } = fawaz(ok);

    await provider.fetchDay(DATE, new AbortController().signal);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => Promise<Response>, FxProviderErrorReason]>([
    [
      "a date that isn't the requested one",
      () => Promise.resolve(text(200, '{"date":"2026-10-03","usd":{"egp":48.5}}')),
      "invalid",
    ],
    [
      "a rate given as a string (A-281)",
      () => Promise.resolve(text(200, `{"date":"${DATE}","usd":{"egp":48.5,"eur":"0.92"}}`)),
      "invalid",
    ],
    ["404", () => Promise.resolve(json(404, {})), "not_found"],
  ])("TP-9.13: %s is FxProviderError %s", async (_label, respond, reason) => {
    const { provider, fetchImpl } = fawaz(respond);

    const error = await failure(() => provider.fetchDay(DATE, new AbortController().signal));

    expect(error).toBeInstanceOf(FxProviderError);
    expect(error.reason).toBe(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("TP-9.24x: the fixed provider (F-133)", () => {
  it("TP-9.24x: returns the seven fixed rates for any date", async () => {
    const provider = createFixedProvider();

    const rates = await provider.fetchDay("2020-01-01", new AbortController().signal);

    expect(provider.name).toBe("fixed");
    expect(Object.fromEntries(rates)).toEqual({
      USD: "1",
      EUR: "0.92",
      GBP: "0.79",
      EGP: "48.5",
      JPY: "149.25",
      KWD: "0.307",
      SAR: "3.75",
    });
  });
});
