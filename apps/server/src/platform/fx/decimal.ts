// F-130: provider decimal parsing. Numbers keep their exact source text, wrapped so they stay
// distinguishable from strings (A-281); rates are normalised to 12 decimal places through F-300.
import { parseDecimal, toFixedDecimalString, type Rational } from "@budmon/shared";

/** A JSON number, as its exact source text. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

type Reviver = (key: string, value: unknown, context: { source: string }) => unknown;

/** `JSON.parse` where every number becomes a `JsonNumber` of its exact source text. */
export function parseJsonKeepingNumberText(text: string): unknown {
  const reviver: Reviver = (_key, value, context) =>
    typeof value === "number" ? new JsonNumber(context.source) : value;
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
}

const UPPER_BOUND: Rational = { num: 10n ** 12n, den: 1n };

/**
 * The rate at 12 decimal places, or null when it isn't a decimal or the normalised value is ≤ 0 or
 * ≥ 10^12 (B-1: checked after rounding, so a tiny positive rate that rounds to zero is refused
 * rather than failing the day's insert on `exchange_rates_positive`).
 */
export function normaliseRate(raw: string): string | null {
  let parsed: Rational;
  try {
    parsed = parseDecimal(raw);
  } catch {
    return null;
  }
  // Early out before rounding, so huge exponents don't build huge strings.
  if (parsed.num <= 0n || parsed.num >= UPPER_BOUND.num * parsed.den * 10n) return null;
  const text = toFixedDecimalString(parsed, 12);
  const r = parseDecimal(text);
  // Denominators are positive (F-300 normalises them).
  if (r.num <= 0n) return null;
  if (r.num * UPPER_BOUND.den >= UPPER_BOUND.num * r.den) return null;
  return text;
}
