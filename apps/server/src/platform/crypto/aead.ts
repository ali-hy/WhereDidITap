// AES-256-GCM over a payload with a seal context, shared by F-111 to F-114.
import { createCipheriv, createDecipheriv } from "node:crypto";
import { EnvelopeAuthError } from "./envelope.js";

export function gcmSeal(
  key: Buffer,
  nonce: Buffer,
  plaintext: Buffer,
  aad: Buffer | null,
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  if (aad !== null) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

/** Throws EnvelopeAuthError when authentication fails. */
export function gcmOpen(
  key: Buffer,
  nonce: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  aad: Buffer | null,
): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    if (aad !== null) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EnvelopeAuthError();
  }
}
