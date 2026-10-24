// F-114: secrets the API itself must open (provider api-local), under a rotatable key ring.
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { gcmOpen, gcmSeal } from "./aead.js";
import {
  aadFor,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeFormatError,
  UnknownKeyVersionError,
  type SealContext,
} from "./envelope.js";

export interface ApiSecretsCipher {
  seal(plaintext: Buffer, ctx: SealContext): Buffer;
  unseal(envelope: Buffer, ctx: SealContext): Buffer;
  currentKeyId(): string;
}

export function createApiSecretsCipher(
  keys: { current: string; keys: ReadonlyMap<string, Buffer> },
  deps: { randomBytes?: (n: number) => Buffer } = {},
): ApiSecretsCipher {
  const random = deps.randomBytes ?? cryptoRandomBytes;
  const currentKey = keys.keys.get(keys.current);
  if (currentKey === undefined) throw new TypeError("the current api-secrets key is missing");
  return {
    seal(plaintext, ctx) {
      const aad = aadFor(ctx);
      const dek = random(32);
      const nonce = random(12);
      try {
        const payload = gcmSeal(dek, nonce, plaintext, aad);
        // The DEK under the key-encryption key: nonce(12) ‖ ct(32) ‖ tag(16), no AAD.
        const kekNonce = random(12);
        const wrapped = gcmSeal(currentKey, kekNonce, dek, null);
        return encodeEnvelope({
          provider: "api-local",
          keyVersion: keys.current,
          wrappedDek: Buffer.concat([kekNonce, wrapped.ciphertext, wrapped.tag]),
          nonce,
          ciphertext: payload.ciphertext,
          tag: payload.tag,
        });
      } finally {
        dek.fill(0);
      }
    },
    unseal(envelope, ctx) {
      const parts = decodeEnvelope(envelope);
      if (parts.provider !== "api-local" || parts.wrappedDek.length !== 12 + 32 + 16) {
        throw new EnvelopeFormatError();
      }
      const kek = keys.keys.get(parts.keyVersion);
      if (kek === undefined) throw new UnknownKeyVersionError();
      const aad = aadFor(ctx);
      const w = parts.wrappedDek;
      const dek = gcmOpen(kek, w.subarray(0, 12), w.subarray(12, 44), w.subarray(44), null);
      try {
        return gcmOpen(dek, parts.nonce, parts.ciphertext, parts.tag, aad);
      } finally {
        dek.fill(0);
      }
    },
    currentKeyId: () => keys.current,
  };
}
