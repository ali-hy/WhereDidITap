// F-141: the S3 object store (Backblaze B2 in stage 0; MinIO in tests).
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Temporal } from "@budmon/shared";
import type { Config } from "../config/schema.js";
import type { Logger } from "../observability/logger.js";
import {
  assertObjectKey,
  assertObjectPrefix,
  checkPresign,
  contentDisposition,
  isObjectKey,
  ObjectStoreError,
  type BucketName,
  type ObjectStore,
} from "./objectStore.js";

type S3Config = Extract<NonNullable<Config["objectStore"]>, { kind: "s3" }>;

/** SDK errors → F-141's reasons. Anything that isn't an S3 answer is `unavailable`. */
function storeError(error: unknown): ObjectStoreError {
  if (error instanceof ObjectStoreError) return error;
  if (error instanceof S3ServiceException) {
    const status = error.$metadata.httpStatusCode;
    // A-293: every 404, NoSuchBucket included, is not_found.
    if (error.name === "NoSuchKey" || error.name === "NoSuchBucket" || status === 404) {
      return new ObjectStoreError("not_found");
    }
    if (status === 403) return new ObjectStoreError("denied");
  }
  return new ObjectStoreError("unavailable");
}

async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw storeError(error);
  }
}

export function createS3ObjectStore(
  cfg: S3Config,
  deps: { logger: Logger; client?: S3Client },
): ObjectStore {
  const client =
    deps.client ??
    new S3Client({
      endpoint: cfg.endpoint.href,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId.reveal(),
        secretAccessKey: cfg.secretAccessKey.reveal(),
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      // A-287: path-style URLs, for B2 and the test's versitygw alike.
      forcePathStyle: true,
    });
  const bucketName = (bucket: BucketName): string =>
    bucket === "exports" ? cfg.buckets.exports : cfg.buckets.erasureLog;

  /**
   * Every object under `prefix`. With `conformingOnly` (A-306, `list` only), keys failing the key
   * rule are skipped and counted; `deletePrefix` lists without it, so strays are deleted too.
   */
  async function* listKeys(
    bucket: BucketName,
    prefix: string,
    conformingOnly: boolean,
  ): AsyncGenerator<{ key: string; lastModified: Temporal.Instant }> {
    let token: string | undefined;
    let skipped = 0;
    try {
      do {
        const page = await mapped(() =>
          client.send(
            new ListObjectsV2Command({
              Bucket: bucketName(bucket),
              Prefix: prefix,
              MaxKeys: 1000,
              ...(token === undefined ? {} : { ContinuationToken: token }),
            }),
          ),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key === undefined || object.LastModified === undefined) continue;
          // A-306: a stray key would make callers' delete throw; skip it, counted.
          if (conformingOnly && !isObjectKey(bucket, object.Key)) {
            skipped += 1;
            continue;
          }
          yield {
            key: object.Key,
            lastModified: Temporal.Instant.fromEpochMilliseconds(object.LastModified.getTime()),
          };
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
    } finally {
      // A-306: the count only, never the keys; also when the consumer stops early or it throws.
      if (skipped > 0) deps.logger.warn("object_keys_skipped", { bucket, count: skipped });
    }
  }

  return {
    async put(bucket, key, body, contentType) {
      assertObjectKey(bucket, key);
      await mapped(() =>
        client.send(
          new PutObjectCommand({
            Bucket: bucketName(bucket),
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
        ),
      );
    },
    async delete(bucket, key) {
      assertObjectKey(bucket, key);
      await mapped(() =>
        client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key })),
      );
    },
    async deletePrefix(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      let deleted = 0;
      let batch: string[] = [];
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return;
        const keys = batch;
        batch = [];
        const result = await mapped(() =>
          client.send(
            new DeleteObjectsCommand({
              Bucket: bucketName(bucket),
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          ),
        );
        if ((result.Errors ?? []).length > 0) throw new ObjectStoreError("unavailable");
        deleted += keys.length;
      };
      for await (const entry of listKeys(bucket, prefix, false)) {
        batch.push(entry.key);
        if (batch.length === 1000) await flush();
      }
      await flush();
      return deleted;
    },
    async *list(bucket, prefix) {
      assertObjectPrefix(bucket, prefix);
      yield* listKeys(bucket, prefix, true);
    },
    async presignGet(bucket, key, ttlSeconds, opts = {}) {
      const expiresIn = checkPresign(bucket, key, ttlSeconds, opts);
      const url = await mapped(() =>
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucketName(bucket),
            Key: key,
            ResponseContentDisposition: contentDisposition(opts.downloadName),
          }),
          { expiresIn },
        ),
      );
      return new URL(url);
    },
  };
}
