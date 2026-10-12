// F-300: currency codes.
export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

export function asCurrencyCode(value: string): CurrencyCode {
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new TypeError("Invalid currency code");
  }
  return value as CurrencyCode;
}
