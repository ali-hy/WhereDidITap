// F-60: RFC 6238 TOTP (SHA-1, 6 digits, 30 s steps).
import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { timingSafeEqualBytes } from "../platform/security/hashing.js";
import { base32Encode } from "./base32.js";

const STEP_SECONDS = 30;
const SECRET_BYTES = 20;

export function generateTotpSecret(randomBytes: (n: number) => Buffer = nodeRandomBytes): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** HOTP(secret, step): dynamic truncation, 6 digits, zero-padded. */
export function totpAt(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[19] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function stepOf(epochSeconds: number): number {
  return Math.floor(epochSeconds / STEP_SECONDS);
}

/**
 * The matching step among the current one and its two neighbours, skipping steps up to
 * `lastUsedStep`; null when the code is malformed or matches none.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowEpochSeconds: number,
  lastUsedStep: number | null,
): number | null {
  const digits = code.replaceAll(" ", "");
  if (!/^\d{6}$/.test(digits)) return null;
  const given = Buffer.from(digits, "utf8");
  const s = stepOf(nowEpochSeconds);
  for (const step of [s - 1, s, s + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqualBytes(Buffer.from(totpAt(secret, step), "utf8"), given)) return step;
  }
  return null;
}

export function otpauthUri(p: {
  secret: Uint8Array;
  accountEmail: string;
  issuer: string;
}): string {
  const issuer = encodeURIComponent(p.issuer);
  return (
    `otpauth://totp/${issuer}:${encodeURIComponent(p.accountEmail)}` +
    `?secret=${base32Encode(p.secret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  );
}
