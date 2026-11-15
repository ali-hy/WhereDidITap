// F-172: sign-up and profile defaults from the browser's locale and zone.
import type { Temporal } from "@budmon/shared";
import regionCurrency from "./regionCurrency.json" with { type: "json" };

const FALLBACK_CURRENCY = "USD";

/** The locale's region currency (CLDR) when it is active, else USD. */
export function defaultCurrencyFor(locale: string, active: readonly string[]): string {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    region = undefined;
  }
  const code =
    region === undefined ? undefined : (regionCurrency as Record<string, string>)[region];
  return code !== undefined && active.includes(code) ? code : FALLBACK_CURRENCY;
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface TimeZoneOption {
  id: string;
  label: string;
  offset: string;
}

/** Every supported zone by name, labelled like "Africa/Cairo (GMT+3)". */
export function timeZoneOptions(now: Temporal.Instant): TimeZoneOption[] {
  const date = new Date(now.epochMilliseconds);
  return Intl.supportedValuesOf("timeZone")
    .toSorted((a, b) => a.localeCompare(b, "en"))
    .map((id) => {
      const offset =
        new Intl.DateTimeFormat("en", { timeZone: id, timeZoneName: "shortOffset" })
          .formatToParts(date)
          .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
      return { id, label: `${id} (${offset})`, offset };
    });
}
