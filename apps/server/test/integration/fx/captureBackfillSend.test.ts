// A-283: capture's INSERT policy on the platform.fx-backfill queue pins singleton_key to
// data->>'rateDate', state to 'created' and policy to the queue's. TP-9.22 (a) to (e), plus extra
// cases TP-9.24x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs. (f) is a
// unit case (unit/fx/captureSingletonKey.test.ts); TP-6.8's capture cases run in
// queue/workers.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBoss } from "../../../src/platform/queue/workers.js";
import type { PgBossLike } from "../../support/jobs.js";
import { failureState, query } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";
import { queuedJobs } from "../../support/s9.js";

const BACKFILL = "platform.fx-backfill";

describe("TP-9.22: capture sends to platform.fx-backfill (F-75 6b, A-283)", () => {
  let testDb: TestDatabase;
  let capture: PgBossLike | undefined;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    const c = createPgBoss(testWorkerConfig(testDb.endpoint, testDb.name, "capture"), "capture");
    await c.start();
    capture = c;
  }, 60_000);

  afterAll(async () => {
    await capture?.stop({ graceful: false });
    await testDb.drop();
  });

  function boss(): PgBossLike {
    if (capture === undefined) throw new Error("pg-boss didn't start");
    return capture;
  }

  const asCapture = (sql: string, values: unknown[] = []) =>
    query(testDb.urlAs("budmon_capture"), sql, values);

  /**
   * A direct INSERT into `pgboss.<table>` as budmon_capture that matches an honest send in every
   * pinned column (A-230's dead_letter; A-283's state, policy and key; A-296's job options, from
   * `pgboss.queue`) except for `state`, `policy` (null: the queue's own), the singleton key
   * (default: the rateDate) and any `columns` given as SQL expressions over `now` and `q`.
   */
  const insertAsCapture = (
    table: "job" | "job_common",
    rateDate: string,
    state: string,
    policy: string | null,
    key: string = rateDate,
    columns: Record<string, string> = {},
  ) => {
    const honest: Record<string, string> = {
      retry_limit: "q.retry_limit",
      retry_delay: "q.retry_delay",
      retry_backoff: "q.retry_backoff",
      retry_delay_max: "q.retry_delay_max",
      expire_seconds: "q.expire_seconds",
      deletion_seconds: "q.deletion_seconds",
      heartbeat_seconds: "q.heartbeat_seconds",
      start_after: "now",
      keep_until: "now + q.retention_seconds * interval '1 second'",
      priority: "0",
      blocking: "false",
      retry_count: "0",
      ...columns,
    };
    const names = Object.keys(honest);
    return asCapture(
      `INSERT INTO pgboss.${table} (name, data, singleton_key, state, policy, dead_letter, ${names.join(", ")})
       SELECT q.name, jsonb_build_object('rateDate', $2::text), $5, $3::pgboss.job_state,
              coalesce($4, q.policy), q.dead_letter, ${names.map((n) => honest[n]).join(", ")}
       FROM pgboss.queue q, (SELECT pg_catalog.now() AS now) t WHERE q.name = $1`,
      [BACKFILL, rateDate, state, policy, key],
    );
  };

  /** Whether a platform.fx-backfill job for `rateDate` is in the queue (read as the owner). */
  async function queued(rateDate: string): Promise<boolean> {
    return (await queuedJobs(testDb, BACKFILL)).some(
      (j) => (j.data as { rateDate?: unknown }).rateDate === rateDate,
    );
  }

  it("TP-9.22 (a): a send with singletonKey = rateDate returns an id; the same send again returns null and leaves one queued row", async () => {
    const first = await boss().send(
      BACKFILL,
      { rateDate: "2026-10-01" },
      { singletonKey: "2026-10-01" },
    );
    const second = await boss().send(
      BACKFILL,
      { rateDate: "2026-10-01" },
      { singletonKey: "2026-10-01" },
    );

    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
    const rows = (await queuedJobs(testDb, BACKFILL)).filter(
      (j) => (j.data as { rateDate?: unknown }).rateDate === "2026-10-01",
    );
    expect(rows).toHaveLength(1);
  });

  it("TP-9.22 (b): a send whose singletonKey isn't the rateDate is 42501 and nothing is queued", async () => {
    expect(
      await failureState(() =>
        boss().send(BACKFILL, { rateDate: "2026-10-02" }, { singletonKey: "x" }),
      ),
    ).toBe("42501");
    expect(await queued("2026-10-02")).toBe(false);
  });

  it("TP-9.22 (c): a send with no singletonKey is 42501 and nothing is queued", async () => {
    expect(await failureState(() => boss().send(BACKFILL, { rateDate: "2026-10-03" }))).toBe(
      "42501",
    );
    expect(await queued("2026-10-03")).toBe(false);
  });

  it("TP-9.22 (e): the queue's own policy is short (so policy 'standard' below is a mismatch)", async () => {
    const [queue] = await query<{ policy: string }>(
      testDb.urlAs("budmon_queue"),
      "SELECT policy FROM pgboss.queue WHERE name = $1",
      [BACKFILL],
    );

    expect(queue?.policy).toBe("short");
  });

  // B-2 (S-9 round 2): the same pins on job_common, which the statements above reach only
  // through job (A-228: each table carries its own policies).
  describe.each(["job", "job_common"] as const)("direct INSERTs into pgboss.%s", (table) => {
    const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
    const offset = table === "job" ? 0 : 10;

    it(`TP-9.22 (d): ${table}: the matching key but state 'retry' is 42501 and nothing is queued`, async () => {
      const rateDate = day(offset + 1);

      expect(await failureState(() => insertAsCapture(table, rateDate, "retry", null))).toBe(
        "42501",
      );
      expect(await queued(rateDate)).toBe(false);
    });

    it(`TP-9.22 (e): ${table}: the matching key, state 'created', policy 'standard' is 42501 and nothing is queued`, async () => {
      const rateDate = day(offset + 2);

      expect(
        await failureState(() => insertAsCapture(table, rateDate, "created", "standard")),
      ).toBe("42501");
      expect(await queued(rateDate)).toBe(false);
    });

    it(`TP-9.22 (b): ${table}: singleton_key 'x' for a different rateDate is 42501 and nothing is queued`, async () => {
      const rateDate = day(offset + 3);

      expect(await failureState(() => insertAsCapture(table, rateDate, "created", null, "x"))).toBe(
        "42501",
      );
      expect(await queued(rateDate)).toBe(false);
    });

    // A-296: each job-option column must equal the queue's (or its fixed honest value).
    it.each([
      ["retry_limit 2147483647", { retry_limit: "2147483647" }, 1],
      ["priority 10", { priority: "10" }, 2],
      ["keep_until 2999-01-01", { keep_until: "'2999-01-01'::timestamptz" }, 3],
      ["expire_seconds 86400", { expire_seconds: "86400" }, 4],
      ["retry_delay 1", { retry_delay: "1" }, 5],
      [
        "start_after tomorrow",
        {
          start_after: "now + interval '1 day'",
          keep_until: "now + interval '1 day' + q.retention_seconds * interval '1 second'",
        },
        6,
      ],
      ["blocking true", { blocking: "true" }, 7],
      ["retry_count 5", { retry_count: "5" }, 8],
      // Review N-2: the remaining pinned columns.
      ["retry_backoff flipped", { retry_backoff: "NOT COALESCE(q.retry_backoff, false)" }, 9],
      ["retry_delay_max changed", { retry_delay_max: "COALESCE(q.retry_delay_max, 0) + 1" }, 10],
      ["deletion_seconds changed", { deletion_seconds: "q.deletion_seconds + 1" }, 11],
      [
        "heartbeat_seconds changed",
        { heartbeat_seconds: "COALESCE(q.heartbeat_seconds, 0) + 30" },
        12,
      ],
      ["group_id set", { group_id: "'g1'" }, 13],
      ["group_tier set", { group_tier: "'t1'" }, 14],
      ["blocked true", { blocked: "true" }, 15],
      ["pending_dependencies 1", { pending_dependencies: "1" }, 16],
    ] as const)(
      `TP-9.22 (A-296): ${table}: an otherwise valid row with %s is 42501 and nothing is queued`,
      async (_label, columns, n) => {
        // One month per table, so every case has its own date.
        const rateDate = `${table === "job" ? "2027-01" : "2027-02"}-${String(n).padStart(2, "0")}`;

        expect(
          await failureState(() =>
            insertAsCapture(table, rateDate, "created", null, rateDate, { ...columns }),
          ),
        ).toBe("42501");
        expect(await queued(rateDate)).toBe(false);
      },
    );

    it(`TP-9.24x: ${table}: the honest row (state 'created', the queue's policy, the matching key) is allowed and queued`, async () => {
      const rateDate = day(offset + 4);

      expect(
        await failureState(() => insertAsCapture(table, rateDate, "created", null)),
      ).toBeUndefined();
      expect(await queued(rateDate)).toBe(true);
    });
  });
});
