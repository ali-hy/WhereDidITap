// F-142: the development object store on the filesystem, and the signed tokens of F-145's route.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Temporal, canonicalJson, type Clock } from "@budmon/shared";
import type { Logger } from "../observability/logger.js";
import {
  assertObjectKey,
  assertObjectPrefix,
  checkPresign,
  isDownloadName,
  isObjectKey,
  ObjectStoreError,
  settle,
  type BucketName,
  type ObjectStore,
} from "./objectStore.js";

/** A token's payload: bucket, key, expiry and the optional download name (A-22). */
export interface ObjectTokenPayload {
  b: BucketName;
  k: string;
  exp: number;
  n?: string;
}

function mac(signingKey: Buffer, payloadPart: string): Buffer {
  return createHmac("sha256", signingKey).update(payloadPart).digest();
}

export function signObjectToken(signingKey: Buffer, payload: ObjectTokenPayload): string {
  const payloadPart = Buffer.from(canonicalJson(payload)).toString("base64url");
  return `${payloadPart}.${mac(signingKey, payloadPart).toString("base64url")}`;
}

/**
 * F-145's checks: the HMAC (constant time), then the payload's shape, the key rules, `exp ≥ now`
 * and `n`'s pattern. Any failure is null.
 */
export function verifyObjectToken(
  signingKey: Buffer,
  token: string,
  now: Temporal.Instant,
): ObjectTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart = "", sigPart = ""] = parts;
  // Compared as text: base64url's last character has unused bits, so decoding first would accept
  // more than one spelling of the same signature.
  const expected = Buffer.from(mac(signingKey, payloadPart).toString("base64url"));
  const given = Buffer.from(sigPart);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { b, k, exp, n } = payload as Record<string, unknown>;
  if (b !== "exports" && b !== "erasure-log") return null;
  if (typeof k !== "string" || typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  try {
    assertObjectKey(b, k);
  } catch {
    return null;
  }
  if (n !== undefined && (typeof n !== "string" || !isDownloadName(n))) return null;
  // A-290: integer epoch seconds, accepted while exp ≥ floor(now / 1000).
  if (exp < Math.floor(now.epochMilliseconds / 1000)) return null;
  return n === undefined ? { b, k, exp } : { b, k, exp, n };
}

/** `<root>/<bucket>/<key>`; keys are validated first, so they never leave the root. */
export function objectPath(root: string, bucket: BucketName, key: string): string {
  return path.join(root, bucket, ...key.split("/"));
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

/** A-439: a permission error is ObjectStoreError("denied"); every other error is unchanged. */
function mapDenied(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EACCES" || code === "EPERM"
    ? new ObjectStoreError("denied", { cause: error })
    : error;
}

async function denying<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw mapDenied(error);
  }
}

async function walk(dir: string, rel: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

export function createFsObjectStore(cfg: {
  root: string;
  publicOrigin: URL;
  /** A-303: null outside the API, where presignGet isn't supported. */
  signingKey: Buffer | null;
  clock: Clock;
  /** A-306: reports keys a listing skipped. */
  logger: Logger;
}): ObjectStore {
  /** Every file under `prefix`, as keys relative to the bucket. */
  const allUnder = (bucket: BucketName, prefix: string): Promise<string[]> =>
    walk(
      path.join(cfg.root, bucket, ...prefix.split("/").filter((s) => s !== "")),
      prefix.replace(/\/$/, ""),
    );

  /** A-306 (`list` only): the conforming keys under `prefix`; strays are counted and logged. */
  const keysUnder = async (bucket: BucketName, prefix: string): Promise<string[]> => {
    const keys = await allUnder(bucket, prefix);
    const valid = keys.filter((key) => isObjectKey(bucket, key));
    const skipped = keys.length - valid.length;
    // A-306: the count only, never the keys.
    if (skipped > 0) cfg.logger.warn("object_keys_skipped", { bucket, count: skipped });
    return valid;
  };

  return {
    async put(bucket, key, body) {
      assertObjectKey(bucket, key);
      const file = objectPath(cfg.root, bucket, key);
      await denying(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body);
      });
    },
    async delete(bucket, key) {
      assertObjectKey(bucket, key);
      await denying(() => rm(objectPath(cfg.root, bucket, key), { force: true }));
    },
    async deletePrefix(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      return denying(async () => {
        // Every file under the prefix, strays included (A-306 filters `list` only).
        const keys = await allUnder(bucket, prefix);
        for (const key of keys) await rm(objectPath(cfg.root, bucket, key), { force: true });
        return keys.length;
      });
    },
    async *list(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      for (const key of await denying(() => keysUnder(bucket, prefix))) {
        let mtimeNs: bigint;
        try {
          mtimeNs = (await stat(objectPath(cfg.root, bucket, key), { bigint: true })).mtimeNs;
        } catch (error) {
          if (isMissing(error)) continue;
          throw mapDenied(error);
        }
        // A-292: the exact mtime, not rounded.
        yield { key, lastModified: Temporal.Instant.fromEpochNanoseconds(mtimeNs) };
      }
    },
    presignGet: (bucket, key, ttlSeconds, opts = {}) =>
      settle(() => {
        const ttl = checkPresign(bucket, key, ttlSeconds, opts);
        if (cfg.signingKey === null) {
          throw new TypeError("presignGet needs the API's signing key");
        }
        // A-290: integer epoch seconds.
        const exp = Math.floor(cfg.clock.now().epochMilliseconds / 1000) + ttl;
        const token = signObjectToken(cfg.signingKey, {
          b: bucket,
          k: key,
          exp,
          ...(opts.downloadName === undefined ? {} : { n: opts.downloadName }),
        });
        return new URL(`/dev/objects/${token}`, cfg.publicOrigin);
      }),
  };
}
