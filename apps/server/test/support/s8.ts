// S-8 test support (credential encryption), owned by the test-architect.
import { expect } from "vitest";
import * as cryptoErrors from "../../src/platform/crypto/cryptoErrors.js";

export type CryptoErrorName =
  "EnvelopeFormatError" | "EnvelopeAuthError" | "UnknownKeyVersionError" | "KmsUnavailableError";

/**
 * `fn` throws or rejects with the A-246 error `name`: an instance of that class from
 * cryptoErrors.ts, `error.name` equal to the class name, and `retryable` true only for
 * KmsUnavailableError.
 */
export async function expectCryptoError(fn: () => unknown, name: CryptoErrorName): Promise<Error> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(cryptoErrors[name]);
  const error = caught as Error & { retryable?: unknown };
  expect(error.name).toBe(name);
  expect(error.retryable).toBe(name === "KmsUnavailableError");
  return error;
}
