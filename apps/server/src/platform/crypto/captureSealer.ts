// F-111: sealing for capture (api, worker-general, worker-capture): only the public key is here.
import {
  constants,
  createPublicKey,
  publicEncrypt,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";
import { gcmSeal } from "./aead.js";
import { aadFor, encodeEnvelope, type SealContext } from "./envelope.js";

export interface CaptureSealer {
  seal(plaintext: Buffer, ctx: SealContext): Buffer;
}

const MIN_MODULUS_BITS = 3072;

export function createCaptureSealer(
  cfg: { publicKeyPem: string; keyVersion: string },
  deps: { randomBytes?: (n: number) => Buffer } = {},
): CaptureSealer {
  let key;
  try {
    key = createPublicKey(cfg.publicKeyPem);
  } catch {
    throw new TypeError("capture public key invalid");
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== "rsa" || bits === undefined || bits < MIN_MODULUS_BITS) {
    throw new TypeError("capture public key must be RSA of at least 3072 bits");
  }
  const random = deps.randomBytes ?? cryptoRandomBytes;
  const provider = cfg.keyVersion.startsWith("local:") ? "local-capture" : "kms-capture";
  return {
    seal(plaintext, ctx) {
      const aad = aadFor(ctx);
      const dek = random(32);
      const nonce = random(12);
      try {
        const { ciphertext, tag } = gcmSeal(dek, nonce, plaintext, aad);
        const wrappedDek = publicEncrypt(
          { key: cfg.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          dek,
        );
        return encodeEnvelope({
          provider,
          keyVersion: cfg.keyVersion,
          wrappedDek,
          nonce,
          ciphertext,
          tag,
        });
      } finally {
        dek.fill(0);
      }
    },
  };
}
