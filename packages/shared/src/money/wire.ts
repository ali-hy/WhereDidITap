// F-304: conversion between Money and the JSON wire number (safe integers only).
import { asCurrencyCode, type CurrencyCode } from "./currency.js";
import { Money } from "./money.js";

export const MAX_WIRE_MINOR = 9007199254740991;

const MAX_WIRE_BIGINT = BigInt(MAX_WIRE_MINOR);

export class MoneyRangeError extends Error {
  override readonly name = "MoneyRangeError";
}

function outOfRange(): MoneyRangeError {
  return new MoneyRangeError("Amount is outside the safe integer range");
}

export function toMoney(minor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(minor)) {
    throw outOfRange();
  }
  return Money.of(BigInt(minor), currency);
}

export function toWire(m: Money): number {
  if (m.minor > MAX_WIRE_BIGINT || m.minor < -MAX_WIRE_BIGINT) {
    throw outOfRange();
  }
  // eslint-disable-next-line no-restricted-syntax -- the range was checked above; this is the one place a bigint amount becomes a wire number
  return Number(m.minor);
}

export function toWireMoney(m: Money): { amount: number; currency: string } {
  return { amount: toWire(m), currency: m.currency };
}

export function fromWireMoney(w: { amount: number; currency: string }): Money {
  if (!Number.isSafeInteger(w.amount)) {
    throw outOfRange();
  }
  return toMoney(w.amount, asCurrencyCode(w.currency));
}
