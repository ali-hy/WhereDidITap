// F-66: hashing utilities. Argon2id for low-entropy secrets, HMAC-SHA-256 for high-entropy tokens,
// constant-time comparison and random tokens (HLD D-22).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";

/** OWASP's Argon2id parameters: 19 MiB, 2 passes, 1 lane, a 16-byte salt. */
// The binding's default algorithm is Argon2id (its `Algorithm` is a const enum, which can't be
// imported here); hashSecret's PHC prefix confirms it (TP-5.9).
const ARGON2ID: Readonly<Options> = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** The PHC string (`$argon2id$v=19$m=19456,t=2,p=1$…`). */
export async function hashSecret(plain: string): Promise<string> {
  return hash(plain, { ...ARGON2ID, salt: randomBytes(16) });
}

/** False for a wrong secret and for a malformed PHC string; never throws. */
export async function verifySecret(phc: string, plain: string): Promise<boolean> {
  try {
    return await verify(phc, plain);
  } catch {
    return false;
  }
}

export function hmacSha256(key: Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** False on a length mismatch; constant time otherwise. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `bytes` random bytes (16..64, default 32) as base64url without padding. */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new RangeError("randomToken: bytes must be an integer from 16 to 64");
  }
  return randomBytes(bytes).toString("base64url");
}

export function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}
