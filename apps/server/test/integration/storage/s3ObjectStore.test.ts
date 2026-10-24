// F-141 the S3 object store against versitygw (A-287), an S3-compatible Testcontainer. TP-10.3,
// plus extra cases TP-10.13x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// Not skipped: it runs in every pnpm test:int, in CI through A-284's mirror prefix.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fixedClock } from "@budmon/shared";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";
import { S3_TEST_IMAGE } from "../../setup/s3Image.js";
import { recordingLogger } from "../../support/platform.js";
import { purgeExpiredExports } from "../../../src/platform/storage/exportsPurge.js";
import { type ObjectStore, ObjectStoreError } from "../../../src/platform/storage/objectStore.js";
import { createS3ObjectStore } from "../../../src/platform/storage/s3ObjectStore.js";
import { USER, exportKey, failure, keysOf } from "../../support/s10.js";

const ACCESS = "budmontest";
const SECRET = "budmontest-secret-key";
const BUCKETS = { exports: "budmon-exports", erasureLog: "budmon-erasure-log" };
const NAME = "budmon-export-2026-10-07.zip";

describe("TP-10.3: the S3 store (F-141, A-22, A-287)", () => {
  let container: StartedTestContainer;
  let endpoint: URL;
  let store: ObjectStore;
  let admin: S3Client;

  const cfg = (buckets = BUCKETS) => ({
    kind: "s3" as const,
    endpoint,
    region: "us-east-1",
    buckets,
    accessKeyId: Secret.of(ACCESS),
    secretAccessKey: Secret.of(SECRET),
  });

  beforeAll(async () => {
    container = await new GenericContainer(S3_TEST_IMAGE)
      .withEnvironment({ ROOT_ACCESS_KEY: ACCESS, ROOT_SECRET_KEY: SECRET })
      .withCommand(["posix", "/tmp"])
      .withExposedPorts(7070)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    endpoint = new URL(`http://${container.getHost()}:${String(container.getMappedPort(7070))}`);
    admin = new S3Client({
      endpoint: endpoint.href,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
    for (const bucket of Object.values(BUCKETS)) {
      await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    store = createS3ObjectStore(cfg(), { logger: recordingLogger() });
  }, 180_000);

  afterAll(async () => {
    admin.destroy();
    await container.stop();
  });

  it("TP-10.3: put, list, delete, delete of a missing key, deletePrefix", async () => {
    const other = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    await store.put("exports", exportKey(other, "csv"), Buffer.from("csv"), "text/csv");

    expect((await keysOf(store, "exports", `users/${USER}/`)).sort()).toEqual(
      [exportKey(), exportKey(other, "csv")].sort(),
    );

    await store.delete("exports", exportKey(other, "csv"));
    await expect(store.delete("exports", exportKey(other, "csv"))).resolves.toBeUndefined();
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey()]);
    expect(await store.deletePrefix("exports", `users/${USER}/`)).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([]);
  });

  // Review R2-B-1: deletePrefix removes every object under the prefix, including one that fails
  // assertObjectKey (written around the store), so an erased user's exports leave nothing behind.
  it("TP-10.3 (R2-B-1): deletePrefix(exports, users/<USER>/) also removes a stray users/<USER>/exports/stray.txt; nothing is left under the prefix", async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    await admin.send(
      new PutObjectCommand({
        Bucket: BUCKETS.exports,
        Key: `users/${USER}/exports/stray.txt`,
        Body: "stray",
      }),
    );

    try {
      await store.deletePrefix("exports", `users/${USER}/`);

      const left = await admin.send(
        new ListObjectsV2Command({ Bucket: BUCKETS.exports, Prefix: `users/${USER}/` }),
      );
      expect((left.Contents ?? []).map((o) => o.Key)).toEqual([]);
    } finally {
      // Leave no stray for later cases (TP-10.5 counts skipped keys) if deletePrefix missed it.
      await admin.send(
        new DeleteObjectCommand({
          Bucket: BUCKETS.exports,
          Key: `users/${USER}/exports/stray.txt`,
        }),
      );
    }
  });

  it(`TP-10.3: presign without and with downloadName ${NAME}: response-content-disposition is attachment / attachment; filename="…", and the server answers with that header`, async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");

    const plain = await store.presignGet("exports", exportKey(), 600);
    const named = await store.presignGet("exports", exportKey(), 600, { downloadName: NAME });
    const plainRes = await fetch(plain);
    const namedRes = await fetch(named);

    expect(plain.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(named.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="${NAME}"`,
    );
    expect(plainRes.status).toBe(200);
    expect(await plainRes.text()).toBe("zip-bytes");
    expect(plainRes.headers.get("content-disposition")).toBe("attachment");
    expect(namedRes.status).toBe(200);
    expect(namedRes.headers.get("content-disposition")).toBe(`attachment; filename="${NAME}"`);
  });

  it("TP-10.3: S3_TEST_IMAGE is pinned by digest", () => {
    expect(S3_TEST_IMAGE).toMatch(/^[^@]+@sha256:[0-9a-f]{64}$/);
  });

  it("TP-10.3: put to a bucket that doesn't exist is ObjectStoreError with reason not_found (A-293)", async () => {
    const missing = createS3ObjectStore(
      cfg({ exports: "budmon-no-such-bucket", erasureLog: BUCKETS.erasureLog }),
      { logger: recordingLogger() },
    );

    const error = await failure(() =>
      missing.put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).toBeInstanceOf(ObjectStoreError);
    expect((error as { reason?: unknown }).reason).toBe("not_found");
  });

  it("TP-10.3: a presigned URL is refused (403) after ttlSeconds", async () => {
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");
    const url = await store.presignGet("exports", exportKey(), 60);

    await new Promise((resolve) => setTimeout(resolve, 62_000));
    const res = await fetch(url);

    expect(res.status).toBe(403);
  }, 90_000);

  // Review B-7: F-141's other error mappings, and lastModified from the listing.
  it("TP-10.13x (B-7): (a) a wrong secretAccessKey: put is ObjectStoreError with reason denied", async () => {
    const wrong = createS3ObjectStore(
      { ...cfg(), secretAccessKey: Secret.of("not-the-secret") },
      { logger: recordingLogger() },
    );

    const error = await failure(() =>
      wrong.put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).toBeInstanceOf(ObjectStoreError);
    expect((error as { reason?: unknown }).reason).toBe("denied");
  });

  it("TP-10.13x (B-7): (b) an endpoint on a closed port: put is ObjectStoreError with reason unavailable", async () => {
    const closed = createS3ObjectStore(
      { ...cfg(), endpoint: new URL("http://127.0.0.1:1") },
      { logger: recordingLogger() },
    );

    const error = await failure(() =>
      closed.put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).toBeInstanceOf(ObjectStoreError);
    expect((error as { reason?: unknown }).reason).toBe("unavailable");
  }, 60_000);

  it("TP-10.13x (B-7): (c) list yields a lastModified within a few seconds of the put", async () => {
    const key = exportKey("0190a0b0-1c2d-7e3f-8a4b-0000000000c3");
    const before = Date.now();
    await store.put("exports", key, Buffer.from("x"), "application/zip");
    const after = Date.now();

    let modified: number | undefined;
    for await (const entry of store.list("exports", `users/${USER}/`)) {
      if (entry.key === key) modified = entry.lastModified.epochMilliseconds;
    }

    expect(modified).toBeDefined();
    expect(modified ?? 0).toBeGreaterThanOrEqual(before - 2_000);
    expect(modified ?? 0).toBeLessThanOrEqual(after + 2_000);
    await store.delete("exports", key);
  });

  // A-306: a stray object under exports/users/, written around the store, aged 8 days by running
  // the purge with a clock 8 days ahead.
  it("TP-10.5 (A-306): S3: a stray users/x/exports/stray.txt is never yielded, the expired conforming object is purged, and one object_keys_skipped warn {bucket: exports, count: 1} is logged without the key", async () => {
    // Earlier cases may leave exports behind; start from none.
    await store.deletePrefix("exports", "users/");
    const logger = recordingLogger();
    const s3 = createS3ObjectStore(cfg(), { logger });
    const expired = exportKey("0190a0b0-1c2d-7e3f-8a4b-0000000000e8");
    await s3.put("exports", expired, Buffer.from("old"), "application/zip");
    await admin.send(
      new PutObjectCommand({
        Bucket: BUCKETS.exports,
        Key: "users/x/exports/stray.txt",
        Body: "stray",
      }),
    );
    const clock = fixedClock(new Date(Date.now() + 8 * 24 * 3_600_000).toISOString());

    const purged = await purgeExpiredExports({ store: s3, clock, logger: recordingLogger() });

    expect(purged).toBe(1);
    const warned = logger.lines.filter((l) => l.event === "object_keys_skipped");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.level).toBe("warn");
    expect(warned[0]?.fields).toMatchObject({ fields: { bucket: "exports", count: 1 } });
    expect(JSON.stringify(logger.lines)).not.toContain("stray");
    expect(await keysOf(s3, "exports", "users/")).toEqual([]);
  });
});
