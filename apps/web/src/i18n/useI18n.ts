// F-206: the i18n context and its hook.
import type { MessageDescriptor } from "@formatjs/intl";
import type { Money, Temporal } from "@budmon/shared";
import { createContext, useContext, type Accessor } from "solid-js";

export interface I18n {
  locale: Accessor<string>;
  dir: Accessor<"ltr" | "rtl">;
  t: (d: MessageDescriptor, v?: Record<string, unknown>) => string;
  formatMoney: (m: Money, minorUnits: number) => string;
  formatDate: (d: Temporal.PlainDate) => string;
  formatInstant: (i: Temporal.Instant, timeZone: string) => string;
  /** A-309: the caller's zone, used beyond 7 days. */
  formatRelative: (i: Temporal.Instant, now: Temporal.Instant, timeZone: string) => string;
  setLocale: (l: string) => Promise<void>;
}

export type { MessageDescriptor };

export const I18nContext = createContext<I18n>();

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (i18n === undefined) throw new Error("useI18n needs an I18nProvider");
  return i18n;
}
