// A-246: the crypto errors. Plain Error subclasses (not BudmonErrors: F-52 maps them to INTERNAL
// or 503, and F-33 reports only the class). Messages never hold envelope content.
abstract class CryptoError extends Error {
  abstract readonly retryable: boolean;
}

/** A malformed envelope, or one for another provider. */
export class EnvelopeFormatError extends CryptoError {
  readonly retryable = false;
  constructor() {
    super("envelope format invalid");
    this.name = "EnvelopeFormatError";
  }
}

/** GCM authentication failed: tampered, or opened with another context. */
export class EnvelopeAuthError extends CryptoError {
  readonly retryable = false;
  constructor() {
    super("envelope authentication failed");
    this.name = "EnvelopeAuthError";
  }
}

/** The envelope's key version isn't one the cipher holds. */
export class UnknownKeyVersionError extends CryptoError {
  readonly retryable = false;
  constructor() {
    super("unknown key version");
    this.name = "UnknownKeyVersionError";
  }
}

/** KMS failed or timed out. */
export class KmsUnavailableError extends CryptoError {
  readonly retryable = true;
  constructor() {
    super("kms unavailable");
    this.name = "KmsUnavailableError";
  }
}
