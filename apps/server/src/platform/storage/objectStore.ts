// F-140: the object store interface, its key rules and its errors.
import type { Temporal } from "@budmon/shared";

export type BucketName = "exports" | "erasure-log";
export type ObjectStoreErrorReason = "not_found" | "denied" | "unavailable";

export class ObjectStoreError extends Error {
  readonly reason: ObjectStoreErrorReason;

  /** A-439: `cause` keeps the underlying error (for example an fs EACCES). */
  constructor(reason: ObjectStoreErrorReason, options?: { cause?: unknown }) {
    super(`object store: ${reason}`, options);
    this.name = "ObjectStoreError";
    this.reason = reason;
  }
}

/** A-22: the file name the browser saves. */
export interface PresignGetOptions {
  downloadName?: string;
}

export interface ObjectStore {
  put(bucket: BucketName, key: string, body: Buffer, contentType: string): Promise<void>;
  /** A missing key isn't an error. */
  delete(bucket: BucketName, key: string): Promise<void>;
  deletePrefix(bucket: BucketName, prefix: string): Promise<number>;
  list(
    bucket: BucketName,
    prefix: string,
  ): AsyncIterable<{ key: string; lastModified: Temporal.Instant }>;
  /** ttlSeconds 60..900, default 900. */
  presignGet(
    bucket: BucketName,
    key: string,
    ttlSeconds?: number,
    opts?: PresignGetOptions,
  ): Promise<URL>;
}

const KEY_PATTERNS: Readonly<Record<BucketName, RegExp>> = {
  exports: /^users\/[0-9a-f-]{36}\/exports\/[0-9a-f-]{36}\.(csv|json|zip)$/,
  "erasure-log": /^records\/\d{8}T\d{6}Z_[0-9a-f-]{36}\.json$/,
};
const PREFIX_PATTERNS: Readonly<Record<BucketName, readonly RegExp[]>> = {
  exports: [/^users\/[0-9a-f-]{36}\/$/, /^users\/$/],
  "erasure-log": [/^records\/$/],
};
const DOWNLOAD_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const DEFAULT_PRESIGN_TTL_SECONDS = 900;

export function assertObjectKey(bucket: BucketName, key: string): void {
  if (!KEY_PATTERNS[bucket].test(key)) throw new RangeError(`invalid ${bucket} key`);
}

export function isObjectKey(bucket: BucketName, key: string): boolean {
  return KEY_PATTERNS[bucket].test(key);
}

/** Prefixes: `users/<uuid>/` or `users/` (exports), `records/` (erasure-log). */
export function assertObjectPrefix(bucket: BucketName, prefix: string): void {
  if (!PREFIX_PATTERNS[bucket].some((p) => p.test(prefix))) {
    throw new RangeError(`invalid ${bucket} prefix`);
  }
}

export function isDownloadName(name: string): boolean {
  return DOWNLOAD_NAME.test(name);
}

/**
 * The checks every `presignGet` makes before any I/O. Returns the TTL to use.
 */
export function checkPresign(
  bucket: BucketName,
  key: string,
  ttlSeconds: number = DEFAULT_PRESIGN_TTL_SECONDS,
  opts: PresignGetOptions = {},
): number {
  assertObjectKey(bucket, key);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
    throw new RangeError("ttlSeconds must be 60..900");
  }
  if (opts.downloadName !== undefined && !isDownloadName(opts.downloadName)) {
    throw new RangeError("invalid downloadName");
  }
  return ttlSeconds;
}

/**
 * Runs a synchronous store operation as a promise, so a validation error rejects (as every
 * F-140 method declares) instead of throwing at the call.
 */
export function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("store operation failed"));
  }
}

/** A-22: the download's Content-Disposition. */
export function contentDisposition(downloadName: string | undefined): string {
  return downloadName === undefined ? "attachment" : `attachment; filename="${downloadName}"`;
}
