// F-133: FX providers. They log nothing (A-268). Each returns upper-case code → the rate's exact decimal text. Errors carry
// only a reason and an HTTP status, never the URL (which holds Open Exchange Rates' app_id).
import type { Secret } from "../observability/redaction.js";
import { JsonNumber, parseJsonKeepingNumberText } from "./decimal.js";

export type FxProviderName = "openexchangerates" | "fawazahmed0" | "fixed";
export type FxProviderErrorReason = "not_found" | "http" | "network" | "invalid";

export class FxProviderError extends Error {
  readonly reason: FxProviderErrorReason;
  readonly status?: number;

  /** A-267: `status` is kept for `http` only; no URL, body or cause. */
  constructor(reason: FxProviderErrorReason, status?: number) {
    const httpStatus = reason === "http" ? status : undefined;
    super(
      httpStatus === undefined
        ? `fx provider: ${reason}`
        : `fx provider: http ${String(httpStatus)}`,
    );
    this.name = "FxProviderError";
    this.reason = reason;
    if (httpStatus !== undefined) this.status = httpStatus;
  }
}

export interface FxProvider {
  readonly name: FxProviderName;
  fetchDay(date: string, signal: AbortSignal): Promise<Map<string, string>>;
}

export interface FxProviders {
  primary: FxProvider;
  fallback: FxProvider;
}

const TIMEOUT_MS = 10_000;

async function get(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      redirect: "error",
    });
  } catch {
    // The cause (which may name the URL) isn't kept.
    throw new FxProviderError("network");
  }
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = parseJsonKeepingNumberText(await response.text());
  } catch {
    throw new FxProviderError("invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FxProviderError("invalid");
  }
  return parsed as Record<string, unknown>;
}

/** `{ code: number }` → upper-case code → the number's source text. A-281: every rate must be a
 * JSON number, else the whole body is invalid. */
function ratesOf(value: unknown): Map<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FxProviderError("invalid");
  }
  const out = new Map<string, string>();
  for (const [code, rate] of Object.entries(value)) {
    if (!(rate instanceof JsonNumber)) throw new FxProviderError("invalid");
    out.set(code.toUpperCase(), rate.source);
  }
  return out;
}

export function createOpenExchangeRates(
  cfg: { baseUrl: URL; appId: Secret<string> },
  deps: { fetch: typeof fetch },
): FxProvider {
  const base = cfg.baseUrl.href.replace(/\/+$/, "");
  return {
    name: "openexchangerates",
    async fetchDay(date, signal) {
      const query = new URLSearchParams({
        app_id: cfg.appId.reveal(),
        base: "USD",
        show_alternative: "false",
      });
      const response = await get(
        deps.fetch,
        `${base}/historical/${encodeURIComponent(date)}.json?${query.toString()}`,
        signal,
      );
      if (response.status === 400 || response.status === 404) {
        throw new FxProviderError("not_found");
      }
      if (response.status < 200 || response.status > 299) {
        throw new FxProviderError("http", response.status);
      }
      const body = await bodyOf(response);
      if (body["base"] !== "USD") throw new FxProviderError("invalid");
      return ratesOf(body["rates"]);
    },
  };
}

export function createFawazahmed0(
  cfg: { baseUrl: string; mirrorUrl: string },
  deps: { fetch: typeof fetch },
): FxProvider {
  const urlFor = (template: string, date: string): string =>
    `${template.replaceAll("{date}", encodeURIComponent(date)).replace(/\/+$/, "")}/currencies/usd.json`;
  return {
    name: "fawazahmed0",
    async fetchDay(date, signal) {
      let response: Response;
      try {
        response = await get(deps.fetch, urlFor(cfg.baseUrl, date), signal);
        if (response.status >= 500) {
          response = await get(deps.fetch, urlFor(cfg.mirrorUrl, date), signal);
        }
      } catch (error) {
        if (!(error instanceof FxProviderError) || error.reason !== "network") throw error;
        response = await get(deps.fetch, urlFor(cfg.mirrorUrl, date), signal);
      }
      if (response.status === 404) throw new FxProviderError("not_found");
      if (response.status < 200 || response.status > 299) {
        throw new FxProviderError("http", response.status);
      }
      const body = await bodyOf(response);
      if (body["date"] !== date) throw new FxProviderError("invalid");
      return ratesOf(body["usd"]);
    },
  };
}

const FIXED_RATES: readonly (readonly [string, string])[] = [
  ["USD", "1"],
  ["EUR", "0.92"],
  ["GBP", "0.79"],
  ["EGP", "48.5"],
  ["JPY", "149.25"],
  ["KWD", "0.307"],
  ["SAR", "3.75"],
];

/** Development and test only (production's config refuses `FX_PROVIDER=fixed`). */
export function createFixedProvider(): FxProvider {
  return {
    name: "fixed",
    fetchDay: () => Promise.resolve(new Map(FIXED_RATES)),
  };
}
