// F-5: device labels shown in the sessions list. The raw user agent is never stored.
import type { ClientKind } from "../platform/http/context.js";

const MAX_LABEL = 80;
const MAX_MODEL = 60;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const BROWSERS: readonly [string, string][] = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["SamsungBrowser/", "Samsung Internet"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

export function deviceLabelFor(
  clientKind: ClientKind,
  userAgent: string | null,
  deviceModel: string | null,
): string {
  if (clientKind === "android") {
    const model = (deviceModel ?? "").replace(CONTROL, "").trim().slice(0, MAX_MODEL);
    return model === "" ? "Android" : `Android · ${model}`;
  }
  if (clientKind === "other") return "Another app";
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([marker]) => ua.includes(marker))?.[1] ?? "A browser";
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? "an unknown system";
  return `${browser} on ${system}`.slice(0, MAX_LABEL);
}
