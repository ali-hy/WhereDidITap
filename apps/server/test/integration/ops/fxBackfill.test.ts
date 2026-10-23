// F-93 fx:backfill (A-444) through runCli: enqueues one platform.fx-backfill job per date as a
// singleton, refuses out-of-range dates, and checks its arguments before reading configuration.
// TP-16.20.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixedClock } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { query } from "../../support/postgres.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerEnv } from "../../support/worker.js";

const CLOCK = "2026-10-12T10:00:00Z";

let testDb: TestDatabase;
let dir: string;
let env: Record<string, string>;

async function cli(argv: string[], withEnv: Readonly<Record<string, string | undefined>> = env) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    argv,
    withEnv,
    { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
    { clock: fixedClock(CLOCK) },
  );
  return { code, stdout, stderr };
}

const jobs = () =>
  query<{ data: unknown; singleton_key: string | null }>(
    testDb.urlAs("budmon_queue"),
    "SELECT data, singleton_key FROM pgboss.job WHERE name = 'platform.fx-backfill' ORDER BY created_on",
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  dir = mkdtempSync(path.join(tmpdir(), "budmon-fx-backfill-"));
  env = testWorkerEnv(dir, testDb.endpoint, testDb.name, "general");
}, 60_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await testDb.drop();
});

describe("TP-16.20: fx:backfill (F-93, A-444)", () => {
  it("TP-16.20 (a): --date 2024-03-05 exits 0, prints {enqueued:true}, one job with rateDate and singletonKey", async () => {
    const r = await cli(["fx:backfill", "--date", "2024-03-05"]);

    expect(r.code, r.stderr.join("\n")).toBe(0);
    expect(r.stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ enqueued: true }]);
    const rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ rateDate: "2024-03-05" });
    expect(rows[0]?.singleton_key).toBe("2024-03-05");
  }, 60_000);

  it("TP-16.20 (b): the same again while the first is queued prints {enqueued:false}, still one job", async () => {
    const r = await cli(["fx:backfill", "--date", "2024-03-05"]);

    expect(r.code, r.stderr.join("\n")).toBe(0);
    expect(r.stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ enqueued: false }]);
    expect(await jobs()).toHaveLength(1);
  }, 60_000);

  it.each([
    ["before FX_FALLBACK_FIRST_DATE", "2024-03-01"],
    ["today (UTC)", "2026-10-12"],
  ])("TP-16.20 (c): %s (%s) exits 2 with date out of range, no job", async (_label, date) => {
    const r = await cli(["fx:backfill", "--date", date]);

    expect(r.code).toBe(2);
    expect(r.stderr).toContain("date out of range");
    expect(r.stdout).toEqual([]);
    expect(await jobs()).toHaveLength(1);
  });

  it.each([
    ["an impossible date", ["fx:backfill", "--date", "2024-02-30"]],
    ["a non-date", ["fx:backfill", "--date", "x"]],
    ["no arguments", ["fx:backfill"]],
    ["an extra argument", ["fx:backfill", "--date", "2024-03-05", "--extra"]],
  ])(
    "TP-16.20 (d): %s exits 64 with the usage text and no configuration error (argv checked first)",
    async (_label, argv) => {
      // The usage text, as printed after `Unknown command:` (TP-10.8's approach).
      const usage = (await cli(["no-such-command"], {})).stderr.slice(1).join("\n");
      const r = await cli(argv, {});

      expect(r.code).toBe(64);
      expect(usage).toContain("fx:backfill --date <YYYY-MM-DD>");
      // An empty environment: reading the configuration would fail with another exit code.
      expect(r.stderr.join("\n")).toBe(usage);
    },
  );
});
