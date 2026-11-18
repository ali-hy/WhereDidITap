// F-61: recovery codes: 60 random bits as 12 base32 characters, stored only as HMACs.
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { hmacSha256 } from "../platform/security/hashing.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MASK_60 = (1n << 60n) - 1n;

type KeyRing = { current: string; keys: ReadonlyMap<string, Buffer> };

/** `n` distinct codes, `XXXX-XXXX-XXXX`, each from 8 drawn bytes (the top 4 bits are dropped). */
export function generateRecoveryCodes(
  n: number,
  randomBytes: (n: number) => Buffer = nodeRandomBytes,
): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    let bits = randomBytes(8).readBigUInt64BE() & MASK_60;
    let raw = "";
    for (let i = 0; i < 12; i += 1) {
      raw = ALPHABET.charAt(Number.parseInt((bits & 31n).toString(), 10)) + raw;
      bits >>= 5n;
    }
    codes.add(formatRecoveryCode(raw));
  }
  return [...codes];
}

export function formatRecoveryCode(raw12: string): string {
  return `${raw12.slice(0, 4)}-${raw12.slice(4, 8)}-${raw12.slice(8, 12)}`;
}

/** Upper case without dashes or whitespace; null unless it is 12 base32 characters. */
export function normaliseRecoveryCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[-\s]/g, "");
  return /^[A-Z2-7]{12}$/.test(code) ? code : null;
}

/** One HMAC-SHA-256 per key in the ring. */
export function recoveryCodeHmacs(
  normalised: string,
  keys: KeyRing,
): { keyId: string; hmac: Buffer }[] {
  return [...keys.keys].map(([keyId, key]) => ({ keyId, hmac: hmacSha256(key, normalised) }));
}

export function currentKeyHmac(normalised: string, keys: KeyRing): { keyId: string; hmac: Buffer } {
  const key = keys.keys.get(keys.current);
  if (key === undefined) throw new TypeError("the current recovery-code key is missing");
  return { keyId: keys.current, hmac: hmacSha256(key, normalised) };
}
