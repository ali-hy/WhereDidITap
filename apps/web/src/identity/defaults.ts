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

/** Every supported zone by name, labelled like "Africa/Cairo (GMT+3)"; UTC is always an option. */
export function timeZoneOptions(now: Temporal.Instant): TimeZoneOption[] {
  const date = new Date(now.epochMilliseconds);
  const ids = Intl.supportedValuesOf("timeZone");
  return (ids.includes("UTC") ? ids : [...ids, "UTC"])
    .toSorted((a, b) => a.localeCompare(b, "en"))
    .map((id) => {
      if (id === "UTC") return { id, label: "UTC (GMT)", offset: "GMT" };
      const offset =
        new Intl.DateTimeFormat("en", { timeZone: id, timeZoneName: "shortOffset" })
          .formatToParts(date)
          .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
      return { id, label: `${id} (${offset})`, offset };
    });
}

const UTC_ALIASES: ReadonlySet<string> = new Set([
  "UTC",
  "Etc/UTC",
  "Etc/UCT",
  "UCT",
  "Etc/Universal",
  "Universal",
  "Etc/Zulu",
  "Zulu",
  "GMT",
  "Etc/GMT",
  "Etc/GMT0",
  "GMT0",
  "Etc/GMT+0",
  "Etc/GMT-0",
  "GMT+0",
  "GMT-0",
  "Etc/Greenwich",
  "Greenwich",
]);

/** The option for [zone]: UTC aliases map to UTC, other aliases to their canonical name; else null. */
export function defaultTimeZone(zone: string, options: readonly { id: string }[]): string | null {
  const listed = (id: string): boolean => options.some((o) => o.id === id);
  if (UTC_ALIASES.has(zone)) return listed("UTC") ? "UTC" : null;
  let canonical = zone;
  try {
    canonical = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (listed(canonical)) return canonical;
  return listed(zone) ? zone : null;
}
