// F-13 withTransaction and createCommitTracker. TP-2.8, plus extra cases TP-2.48x.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommitTracker, withTransaction } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../../support/testDatabase.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

beforeEach(async () => {
  await resetBetweenTests(testDb);
});

async function insertCounter(handle: DbHandle, key: string): Promise<void> {
  await handle.executeSql(
    "INSERT INTO rate_limit_counters (bucket_key, window_start, hits, expires_at) VALUES ($1, now(), 1, now() + interval '10 minutes')",
    [key],
  );
}

async function counterKeys(): Promise<string[]> {
  const { rows } = await testDb.database.handle.executeSql(
    "SELECT bucket_key FROM rate_limit_counters ORDER BY bucket_key",
  );
  return rows.map((r) => String(r["bucket_key"]));
}

function serializationFailure(): Error {
  return Object.assign(new Error("could not serialize access"), { code: "40001" });
}

describe("TP-2.8: withTransaction", () => {
  it("TP-2.8 (a): resolving commits, then marks the tracker committed", async () => {
    const tracker = createCommitTracker();

    const value = await withTransaction(
      testDb.database,
      async (tx) => {
        expect(tx.inTransaction).toBe(true);
        await insertCounter(tx, "t:a");
        return "done";
      },
      { tracker },
    );

    expect(value).toBe("done");
    expect(tracker.committed).toBe(true);
    expect(await counterKeys()).toEqual(["t:a"]);
  });

  it("TP-2.8 (b): throwing rolls back and rethrows; the tracker stays uncommitted", async () => {
    const tracker = createCommitTracker();
    const failure = new Error("boom");

    const outcome = withTransaction(
      testDb.database,
      async (tx) => {
        await insertCounter(tx, "t:b");
        throw failure;
      },
      { tracker },
    );

    await expect(outcome).rejects.toBe(failure);
    expect(tracker.committed).toBe(false);
    expect(await counterKeys()).toEqual([]);
  });

  it("TP-2.8 (c): a 40001 error twice is retried; the third attempt succeeds after two sleeps of 10..49 ms", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const randoms = [0, 0.999];
    let calls = 0;

    const value = await withTransaction(
      testDb.database,
      async (tx) => {
        calls += 1;
        await insertCounter(tx, `t:c${String(calls)}`);
        if (calls <= 2) throw serializationFailure();
        return calls;
      },
      { sleep, random: () => randoms.shift() ?? 0.5 },
    );

    expect(value).toBe(3);
    expect(calls).toBe(3);
    expect(sleep.mock.calls).toEqual([[10], [49]]);
    expect(await counterKeys()).toEqual(["t:c3"]);
  });

  it("TP-2.8 (d): a 40001 error on all four attempts is rethrown after 4 calls", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    let calls = 0;
    const failures: Error[] = [];

    const outcome = withTransaction(
      testDb.database,
      () => {
        calls += 1;
        const failure = serializationFailure();
        failures.push(failure);
        return Promise.reject(failure);
      },
      { sleep, random: () => 0.5 },
    );

    const rejected = await outcome.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(calls).toBe(4);
    expect(rejected).toBe(failures[3]);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("TP-2.48x: a 40P01 (deadlock) error is retried too", async () => {
    let calls = 0;

    const value = await withTransaction(
      testDb.database,
      () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(Object.assign(new Error("deadlock"), { code: "40P01" }));
        }
        return Promise.resolve("ok");
      },
      { sleep: () => Promise.resolve(), random: () => 0 },
    );

    expect(value).toBe("ok");
    expect(calls).toBe(2);
  });

  it("TP-2.48x: another error isn't retried and is rethrown unchanged", async () => {
    let calls = 0;
    const failure = Object.assign(new Error("unique violation"), { code: "23505" });

    const outcome = withTransaction(
      testDb.database,
      () => {
        calls += 1;
        return Promise.reject(failure);
      },
      { sleep: () => Promise.resolve(), random: () => 0 },
    );

    await expect(outcome).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("TP-2.48x: serializable isolation is applied when asked for", async () => {
    const level = await withTransaction(
      testDb.database,
      async (tx) => {
        const { rows } = await tx.executeSql("SHOW transaction_isolation");
        return rows[0]?.["transaction_isolation"];
      },
      { isolation: "serializable" },
    );

    expect(level).toBe("serializable");
  });

  it("TP-2.48x: the default isolation is read committed", async () => {
    const level = await withTransaction(testDb.database, async (tx) => {
      const { rows } = await tx.executeSql("SHOW transaction_isolation");
      return rows[0]?.["transaction_isolation"];
    });

    expect(level).toBe("read committed");
  });

  it("TP-2.48x: the pool's client is released after a failure (later transactions still run)", async () => {
    for (let i = 0; i < 10; i += 1) {
      await withTransaction(testDb.database, () => Promise.reject(new Error("x"))).catch(
        () => undefined,
      );
    }

    expect(await withTransaction(testDb.database, () => Promise.resolve("still works"))).toBe(
      "still works",
    );
  });
});
