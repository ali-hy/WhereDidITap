// F-305: locale-aware money formatting from the exact decimal string.
import { rational, toFixedDecimalString } from "./rational.js";
import type { Money } from "./money.js";

export function formatMoney(
  m: Money,
  opts: {
    locale: string;
    minorUnits: number;
    currencyDisplay?: "code" | "symbol" | "narrowSymbol";
    signDisplay?: "auto" | "never" | "always" | "exceptZero";
  },
): string {
  if (!Number.isInteger(opts.minorUnits) || opts.minorUnits < 0 || opts.minorUnits > 4) {
    throw new RangeError("minorUnits must be an integer from 0 to 4");
  }
  const decimal = toFixedDecimalString(
    rational(m.minor, 10n ** BigInt(opts.minorUnits)),
    opts.minorUnits,
  );
  return new Intl.NumberFormat(opts.locale, {
    style: "currency",
    currency: m.currency,
    currencyDisplay: opts.currencyDisplay ?? "code",
    minimumFractionDigits: opts.minorUnits,
    maximumFractionDigits: opts.minorUnits,
    signDisplay: opts.signDisplay ?? "auto",
  }).format(decimal as `${number}`);
}
