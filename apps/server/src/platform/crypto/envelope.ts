// F-110: the sealed-envelope format (v1).
import { EnvelopeFormatError } from "./cryptoErrors.js";

export {
  EnvelopeAuthError,
  EnvelopeFormatError,
  KmsUnavailableError,
  UnknownKeyVersionError,
} from "./cryptoErrors.js";
export type EnvelopeProvider = "kms-capture" | "local-capture" | "api-local";

export interface SealContext {
  table: string;
  rowId: string;
  purpose: string;
}

export interface EnvelopeParts {
  provider: EnvelopeProvider;
  keyVersion: string;
  wrappedDek: Buffer;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

const VERSION = 0x01;
const PROVIDER_BYTES: Readonly<Record<EnvelopeProvider, number>> = {
  "kms-capture": 0x01,
  "local-capture": 0x02,
  "api-local": 0x03,
};
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_WRAPPED_DEK = 1024;
const CONTEXT_FIELD = /^[A-Za-z0-9_.:-]{1,64}$/;

function providerOf(byte: number | undefined): EnvelopeProvider {
  for (const [provider, value] of Object.entries(PROVIDER_BYTES)) {
    if (value === byte) return provider as EnvelopeProvider;
  }
  throw new EnvelopeFormatError();
}

export function encodeEnvelope(p: EnvelopeParts): Buffer {
  const keyVersion = Buffer.from(p.keyVersion, "utf8");
  if (
    keyVersion.length < 1 ||
    keyVersion.length > 255 ||
    p.wrappedDek.length < 1 ||
    p.wrappedDek.length > MAX_WRAPPED_DEK ||
    p.nonce.length !== NONCE_BYTES ||
    p.tag.length !== TAG_BYTES
  ) {
    throw new EnvelopeFormatError();
  }
  const w = Buffer.alloc(2);
  w.writeUInt16BE(p.wrappedDek.length);
  return Buffer.concat([
    Buffer.from([VERSION, PROVIDER_BYTES[p.provider], keyVersion.length]),
    keyVersion,
    w,
    p.wrappedDek,
    p.nonce,
    p.ciphertext,
    p.tag,
  ]);
}

export function decodeEnvelope(b: Buffer): EnvelopeParts {
  if (b.length < 3 || b[0] !== VERSION) throw new EnvelopeFormatError();
  const provider = providerOf(b[1]);
  const l = b[2] ?? 0;
  if (l < 1 || b.length < 3 + l + 2) throw new EnvelopeFormatError();
  const keyVersion = b.subarray(3, 3 + l).toString("utf8");
  const w = b.readUInt16BE(3 + l);
  if (w < 1 || w > MAX_WRAPPED_DEK) throw new EnvelopeFormatError();
  const dekStart = 5 + l;
  const nonceStart = dekStart + w;
  const ciphertextStart = nonceStart + NONCE_BYTES;
  if (b.length < ciphertextStart + TAG_BYTES) throw new EnvelopeFormatError();
  return {
    provider,
    keyVersion,
    wrappedDek: Buffer.from(b.subarray(dekStart, nonceStart)),
    nonce: Buffer.from(b.subarray(nonceStart, ciphertextStart)),
    ciphertext: Buffer.from(b.subarray(ciphertextStart, b.length - TAG_BYTES)),
    tag: Buffer.from(b.subarray(b.length - TAG_BYTES)),
  };
}

/** utf8 "budmon/v1|<table>|<rowId>|<purpose>": binds an envelope to its row and purpose. */
export function aadFor(ctx: SealContext): Buffer {
  for (const field of [ctx.table, ctx.rowId, ctx.purpose]) {
    if (!CONTEXT_FIELD.test(field)) throw new RangeError("invalid seal context");
  }
  return Buffer.from(`budmon/v1|${ctx.table}|${ctx.rowId}|${ctx.purpose}`, "utf8");
}

export function keyVersionOf(b: Buffer): string {
  return decodeEnvelope(b).keyVersion;
}
