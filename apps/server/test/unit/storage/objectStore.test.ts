// F-140 key, prefix, TTL and download-name rules, F-143 the memory store and F-144 the exports
// purge. TP-10.1, TP-10.4 and TP-10.5, plus extra cases TP-10.13x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Temporal, fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { recordingLogger } from "../../support/platform.js";
import { purgeExpiredExports } from "../../../src/platform/storage/exportsPurge.js";
import { createFsObjectStore } from "../../../src/platform/storage/fsObjectStore.js";
import { createMemoryObjectStore } from "../../../src/platform/storage/memoryObjectStore.js";
import { assertObjectKey, type BucketName } from "../../../src/platform/storage/objectStore.js";
import { EXPORT_ID, USER, exportKey, failure, keysOf } from "../../support/s10.js";

const NOW = "2026-10-07T12:00:00Z";
const RECORD = `records/20261005T120000Z_${USER}.json`;

function memoryStore(now = NOW) {
  const clock = fixedClock(now);
  return { store: createMemoryObjectStore(clock), clock };
}

describe("TP-10.1: key, prefix, TTL and download-name rules (F-140, A-22)", () => {
  it.each<[string, BucketName, string]>([
    ["an exports zip", "exports", exportKey()],
    ["an exports csv", "exports", exportKey(EXPORT_ID, "csv")],
    ["an exports json", "exports", exportKey(EXPORT_ID, "json")],
    ["an erasure-log record", "erasure-log", RECORD],
  ])("TP-10.1: %s passes assertObjectKey and put", async (_label, bucket, key) => {
    const { store } = memoryStore();

    expect(() => {
      assertObjectKey(bucket, key);
    }).not.toThrow();
    await expect(
      store.put(bucket, key, Buffer.from("x"), "application/octet-stream"),
    ).resolves.toBeUndefined();
  });

  it.each<[string, BucketName, string]>([
    ["a .txt export", "exports", exportKey(EXPORT_ID, "txt")],
    ["an upper-case user id", "exports", exportKey(EXPORT_ID, "zip", USER.toUpperCase())],
    ["a short id", "exports", "users/abc/exports/def.zip"],
    ["a leading slash", "exports", `/${exportKey()}`],
    ["a path traversal", "exports", `users/${USER}/exports/../${EXPORT_ID}.zip`],
    ["a record key in exports", "exports", RECORD],
    ["an export key in erasure-log", "erasure-log", exportKey()],
    ["a record with a dashed date", "erasure-log", `records/2026-10-05T120000Z_${USER}.json`],
    ["a record without Z", "erasure-log", `records/20261005T120000_${USER}.json`],
    ["a record that isn't .json", "erasure-log", `records/20261005T120000Z_${USER}.txt`],
    ["an empty key", "exports", ""],
  ])(
    "TP-10.1: %s is RangeError from assertObjectKey, put, delete and presignGet",
    async (_label, bucket, key) => {
      const { store } = memoryStore();

      expect(() => {
        assertObjectKey(bucket, key);
      }).toThrow(RangeError);
      expect(
        await failure(() => store.put(bucket, key, Buffer.from("x"), "text/plain")),
      ).toBeInstanceOf(RangeError);
      expect(await failure(() => store.delete(bucket, key))).toBeInstanceOf(RangeError);
      expect(await failure(() => store.presignGet(bucket, key))).toBeInstanceOf(RangeError);
    },
  );

  it.each<[BucketName, string]>([
    ["exports", "users/"],
    ["exports", `users/${USER}/`],
    ["erasure-log", "records/"],
  ])("TP-10.1: prefix %s %j is accepted by list and deletePrefix", async (bucket, prefix) => {
    const { store } = memoryStore();

    expect(await keysOf(store, bucket, prefix)).toEqual([]);
    expect(await store.deletePrefix(bucket, prefix)).toBe(0);
  });

  it.each([[""], ["users"], ["users/abc/"], ["other/"], [`users/${USER}`], ["/users/"]])(
    "TP-10.1: prefix %j is RangeError from list and deletePrefix",
    async (prefix) => {
      const { store } = memoryStore();

      expect(await failure(() => keysOf(store, "exports", prefix))).toBeInstanceOf(RangeError);
      expect(await failure(() => store.deletePrefix("exports", prefix))).toBeInstanceOf(RangeError);
    },
  );

  it.each([[30], [901], [59], [0]])("TP-10.1: ttlSeconds %i is RangeError", async (ttl) => {
    const { store } = memoryStore();

    expect(await failure(() => store.presignGet("exports", exportKey(), ttl))).toBeInstanceOf(
      RangeError,
    );
  });

  it.each([[60], [900]])("TP-10.13x: ttlSeconds %i is accepted", async (ttl) => {
    const { store } = memoryStore();

    await expect(store.presignGet("exports", exportKey(), ttl)).resolves.toBeInstanceOf(URL);
  });

  it.each([["budmon-export-2026-10-07.zip"], ["a".repeat(100)]])(
    "TP-10.1: downloadName %j passes",
    async (downloadName) => {
      const { store } = memoryStore();

      await expect(
        store.presignGet("exports", exportKey(), 900, { downloadName }),
      ).resolves.toBeInstanceOf(URL);
    },
  );

  it.each([[""], ["a".repeat(101)], ["a b.zip"], ['a"b.zip'], ["x/y.zip"], ["é.zip"]])(
    "TP-10.1: downloadName %j is RangeError",
    async (downloadName) => {
      const { store } = memoryStore();

      expect(
        await failure(() => store.presignGet("exports", exportKey(), 900, { downloadName })),
      ).toBeInstanceOf(RangeError);
    },
  );
});

describe("TP-10.4: the memory store (F-143, A-22)", () => {
  it("TP-10.4: put, list (with lastModified), delete, delete of a missing key, deletePrefix", async () => {
    const { store, clock } = memoryStore();
    const other = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
    await store.put("exports", exportKey(), Buffer.from("zip"), "application/zip");
    clock.advance({ minutes: 1 });
    await store.put("exports", exportKey(other, "csv"), Buffer.from("csv"), "text/csv");

    const listed: { key: string; lastModified: Temporal.Instant }[] = [];
    for await (const entry of store.list("exports", `users/${USER}/`)) listed.push(entry);

    expect(listed.map((e) => e.key).sort()).toEqual([exportKey(), exportKey(other, "csv")].sort());
    expect(listed.find((e) => e.key === exportKey())?.lastModified.toString()).toBe(
      Temporal.Instant.from(NOW).toString(),
    );

    await store.delete("exports", exportKey());
    await expect(store.delete("exports", exportKey())).resolves.toBeUndefined();
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey(other, "csv")]);

    expect(await store.deletePrefix("exports", `users/${USER}/`)).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([]);
  });

  it("TP-10.4: presignGet without a name is memory://exports/<key>?exp=<epoch>, with no n parameter", async () => {
    const { store } = memoryStore();

    const url = await store.presignGet("exports", exportKey(), 600);

    expect(url.href.startsWith(`memory://exports/${exportKey()}?exp=`)).toBe(true);
    // A-290: epoch seconds, floor(now / 1000) + ttl.
    expect(url.searchParams.get("exp")).toBe(String(Math.floor(Date.parse(NOW) / 1000) + 600));
    expect(url.searchParams.has("n")).toBe(false);
  });

  it("TP-10.4: presignGet with downloadName adds &n=budmon-export-2026-10-07.zip", async () => {
    const { store } = memoryStore();

    const url = await store.presignGet("exports", exportKey(), 600, {
      downloadName: "budmon-export-2026-10-07.zip",
    });

    expect(url.href.startsWith(`memory://exports/${exportKey()}?exp=`)).toBe(true);
    expect(url.searchParams.get("n")).toBe("budmon-export-2026-10-07.zip");
  });

  it("TP-10.13x: the snapshot holds the body of what was put", async () => {
    const { store } = memoryStore();
    await store.put("exports", exportKey(), Buffer.from("zip-bytes"), "application/zip");

    const bodies = [...store.snapshot().values()].map((v) => v.body.toString());

    expect(bodies).toEqual(["zip-bytes"]);
  });
});

describe("TP-10.5: exports older than 7 days are purged (F-144)", () => {
  it("TP-10.5: objects at now − 8 d and now − 6 d: purge deletes 1 and logs exports_purged {count: 1}; an erasure-log record at now − 30 d survives (review B-8)", async () => {
    const { store, clock } = memoryStore("2026-09-07T12:00:00Z");
    const old = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000008");
    const recent = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000006");
    await store.put("erasure-log", RECORD, Buffer.from("{}"), "application/json");
    clock.advance({ hours: 22 * 24 });
    await store.put("exports", old, Buffer.from("old"), "application/zip");
    clock.advance({ hours: 2 * 24 });
    await store.put("exports", recent, Buffer.from("recent"), "application/zip");
    clock.advance({ hours: 6 * 24 });
    const logger = recordingLogger();

    const count = await purgeExpiredExports({ store, clock, logger });

    expect(count).toBe(1);
    expect(await keysOf(store, "exports", "users/")).toEqual([recent]);
    expect(await keysOf(store, "erasure-log", "records/")).toEqual([RECORD]);
    expect(logger.lines.filter((l) => l.event === "exports_purged").map((l) => l.fields)).toEqual([
      expect.objectContaining({ fields: { count: 1 } }),
    ]);
  });

  it("TP-10.13x: an object exactly 7 days old is kept (lastModified < now − 7 days purges)", async () => {
    const { store, clock } = memoryStore("2026-09-30T12:00:00Z");
    await store.put("exports", exportKey(), Buffer.from("x"), "application/zip");
    clock.advance({ hours: 7 * 24 });

    expect(await purgeExpiredExports({ store, clock, logger: recordingLogger() })).toBe(0);
    expect(await keysOf(store, "exports", "users/")).toEqual([exportKey()]);
  });
});

describe("TP-10.5 (A-306): the fs store's list skips a stray key", () => {
  it("TP-10.5 (A-306): fs: a stray users/x/exports/stray.txt is never yielded, the expired conforming object is purged, and one object_keys_skipped warn {bucket: exports, count: 1} is logged without the key", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "budmon-fs-stray-"));
    try {
      const logger = recordingLogger();
      const store = createFsObjectStore({
        root,
        publicOrigin: new URL("http://localhost:5173"),
        signingKey: null,
        clock: fixedClock(NOW),
        logger,
      });
      const expired = exportKey("0190a0b0-1c2d-7e3f-8a4b-0000000000e8");
      await store.put("exports", expired, Buffer.from("old"), "application/zip");
      // Written around the store; both files are "aged 8 days" by purging with a clock 8 days on.
      const stray = path.join(root, "exports", "users", "x", "exports", "stray.txt");
      mkdirSync(path.dirname(stray), { recursive: true });
      writeFileSync(stray, "stray");
      const clock = fixedClock(new Date(Date.now() + 8 * 24 * 3_600_000).toISOString());

      const purged = await purgeExpiredExports({ store, clock, logger: recordingLogger() });

      expect(purged).toBe(1);
      const warned = logger.lines.filter((l) => l.event === "object_keys_skipped");
      expect(warned).toHaveLength(1);
      expect(warned[0]?.level).toBe("warn");
      expect(warned[0]?.fields).toMatchObject({ fields: { bucket: "exports", count: 1 } });
      expect(JSON.stringify(logger.lines)).not.toContain("stray");
      expect(await keysOf(store, "exports", "users/")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Review B-1: every method returns a promise; a validation error is a rejection, never a
// synchronous throw (F-140, F-143 parity with S3).
describe("TP-10.13x (B-1): validation errors reject", () => {
  async function rejectsWithoutThrowing(call: () => Promise<unknown>, error: new () => Error) {
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = call();
    }).not.toThrow();
    await expect(promise).rejects.toThrow(error);
  }

  it.each<[string, (s: ReturnType<typeof memoryStore>["store"]) => Promise<unknown>]>([
    ["put with a bad key", (s) => s.put("exports", "bad", Buffer.from("x"), "text/plain")],
    ["delete with a bad key", (s) => s.delete("exports", "bad")],
    ["deletePrefix with a bad prefix", (s) => s.deletePrefix("exports", "bad/")],
    ["presignGet with a bad key", (s) => s.presignGet("exports", "bad")],
    ["presignGet with a bad ttl", (s) => s.presignGet("exports", exportKey(), 30)],
    [
      "presignGet with a bad downloadName",
      (s) => s.presignGet("exports", exportKey(), 600, { downloadName: "a b" }),
    ],
  ])("TP-10.13x (B-1): memory store: %s rejects with RangeError", async (_label, call) => {
    const { store } = memoryStore();

    await rejectsWithoutThrowing(() => call(store), RangeError);
  });

  it("TP-10.13x (B-1): fs store: presignGet with a bad key rejects with RangeError; without a signing key (A-303) it rejects with TypeError", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "budmon-fs-reject-"));
    try {
      const make = (signingKey: Buffer | null) =>
        createFsObjectStore({
          root,
          publicOrigin: new URL("http://localhost:5173"),
          signingKey,
          clock: fixedClock(NOW),
          logger: recordingLogger(),
        });

      await rejectsWithoutThrowing(
        () => make(Buffer.alloc(32, 1)).presignGet("exports", "bad"),
        RangeError,
      );
      await rejectsWithoutThrowing(() => make(null).presignGet("exports", exportKey()), TypeError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
