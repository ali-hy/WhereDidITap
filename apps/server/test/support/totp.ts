// RFC 6238 TOTP and RFC 4648 base32 for identity's server tests (identity LLD §10.1), computed
// independently of F-60 so integration tests get correct codes without trusting the code under
// test. Owned by the test-architect.
//
// - base32ToBytes(s): RFC 4648 decode, ignoring whitespace and case.
// - totp(secret, step): HOTP-SHA-1 of the step, 6 digits, zero-padded.
// - stepAt(instant): floor(epoch seconds / 30).
// - codeAt(secret, instant, offset): the code for stepAt(instant) + offset.
// - wrongCode(secret, instant): a 6-digit code valid for none of steps s − 1 to s + 1.
import { createHmac } from "node:crypto";
import type { Temporal } from "@budmon/shared";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32ToBytes(s: string): Buffer {
  const clean = s.replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[19] ?? 0) & 15;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function stepAt(at: Temporal.Instant): number {
  return Math.floor(at.epochMilliseconds / 30_000);
}

export function codeAt(secret: Uint8Array, at: Temporal.Instant, offset = 0): string {
  return totp(secret, stepAt(at) + offset);
}

export function wrongCode(secret: Uint8Array, at: Temporal.Instant): string {
  const valid = new Set([-1, 0, 1].map((d) => codeAt(secret, at, d)));
  for (const candidate of ["000000", "111111", "222222", "333333"]) {
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error("unreachable: four candidates can't all be valid");
}
