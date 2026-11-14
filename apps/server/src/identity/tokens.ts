// F-2: token formats (LD-8). A token is `<prefix>_<base64url(32 random bytes)>`.
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { sha256 } from "../platform/security/hashing.js";

export type TokenKind =
  | "access"
  | "refresh"
  | "challenge"
  | "state"
  | "handoff"
  | "ticket"
  | "invitation"
  | "reset"
  | "device";

export const TOKEN_PREFIX: Readonly<Record<TokenKind, string>> = {
  access: "bma",
  refresh: "bmr",
  challenge: "bmc",
  state: "bmg",
  handoff: "bmh",
  ticket: "bmt",
  invitation: "bmi",
  reset: "bmp",
  device: "bmd",
};

export function generateToken(
  kind: TokenKind,
  randomBytes: (n: number) => Buffer = nodeRandomBytes,
): string {
  return `${TOKEN_PREFIX[kind]}_${randomBytes(32).toString("base64url")}`;
}

/** The value when it's a well-formed token of the kind, else null. Never throws. */
export function parseToken(kind: TokenKind, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pattern = new RegExp(`^${TOKEN_PREFIX[kind]}_[A-Za-z0-9_-]{43}$`);
  return pattern.test(value) ? value : null;
}

/** SHA-256 of the UTF-8 string: 32 bytes. */
export function hashToken(token: string): Buffer {
  return sha256(token);
}

/** A bare base64url nonce (32 bytes, 43 characters). */
export function generateNonce(randomBytes: (n: number) => Buffer = nodeRandomBytes): string {
  return randomBytes(32).toString("base64url");
}
