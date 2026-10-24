// F-103 createCursorCodec, F-104 filterHash and F-105 paginate: opaque, authenticated, expiring
// list cursors.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";
import { canonicalJson, type Clock } from "@budmon/shared";
import { ValidationFailedError } from "../errors/platformErrors.js";

export type SortKey = readonly (string | number | boolean | null)[];

export interface CursorCodec {
  encode(p: { sortKey: SortKey; id: string; filterHash: string }): string;
  decode(token: string, expectedFilterHash: string): { sortKey: SortKey; id: string };
}

const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 512;
const LIFETIME_SECONDS = 86_400;
/** A-243: a cursor can't expire later than a fresh one would, give or take clock skew. */
const MAX_SKEW_SECONDS = 300;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Every decode failure is the same error, so a client learns nothing about why. */
function invalidCursor(): ValidationFailedError {
  return new ValidationFailedError([
    { path: ["cursor"], code: "invalid_cursor", message: "Invalid cursor" },
  ]);
}

function isSortValue(v: unknown): v is string | number | boolean | null {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

export function createCursorCodec(deps: {
  key: Buffer;
  clock: Clock;
  randomBytes?: (n: number) => Buffer;
}): CursorCodec {
  const random = deps.randomBytes ?? cryptoRandomBytes;
  const nowSeconds = (): number => Math.floor(deps.clock.now().epochMilliseconds / 1000);
  return {
    encode({ sortKey, id, filterHash: f }) {
      const plaintext = canonicalJson({
        v: 1,
        s: sortKey,
        id,
        f,
        exp: nowSeconds() + LIFETIME_SECONDS,
      });
      const nonce = random(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", deps.key, nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([
        Buffer.from([VERSION]),
        nonce,
        ciphertext,
        cipher.getAuthTag(),
      ]).toString("base64url");
    },
    decode(token, expectedFilterHash) {
      if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !BASE64URL.test(token)) {
        throw invalidCursor();
      }
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length < 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== VERSION) {
        throw invalidCursor();
      }
      let parsed: unknown;
      try {
        const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
        const tag = bytes.subarray(bytes.length - TAG_BYTES);
        const ciphertext = bytes.subarray(1 + NONCE_BYTES, bytes.length - TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", deps.key, nonce);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        parsed = JSON.parse(plaintext.toString("utf8"));
      } catch {
        throw invalidCursor();
      }
      const p = parsed as { v?: unknown; s?: unknown; id?: unknown; f?: unknown; exp?: unknown };
      if (
        p.v !== 1 ||
        !Array.isArray(p.s) ||
        !p.s.every(isSortValue) ||
        typeof p.id !== "string" ||
        typeof p.exp !== "number" ||
        p.exp < nowSeconds() ||
        p.exp > nowSeconds() + LIFETIME_SECONDS + MAX_SKEW_SECONDS ||
        p.f !== expectedFilterHash
      ) {
        throw invalidCursor();
      }
      return { sortKey: p.s, id: p.id };
    },
  };
}

/** F-104: the first 22 characters of base64url(sha256(canonicalJson(filters))). */
export function filterHash(filters: unknown): string {
  return createHash("sha256").update(canonicalJson(filters)).digest("base64url").slice(0, 22);
}

/** F-105: callers fetch `limit + 1` rows; the extra one only says there's a next page. */
export function paginate<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => { sortKey: SortKey; id: string },
  filterHashValue: string,
  codec: CursorCodec,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: [...rows], nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  if (last === undefined) return { items, nextCursor: null };
  return { items, nextCursor: codec.encode({ ...keyOf(last), filterHash: filterHashValue }) };
}
