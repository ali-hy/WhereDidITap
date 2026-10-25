// F-146 the erasure log and F-151 replayErasures. TP-10.6 and TP-10.7, plus extra cases TP-10.13x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal, canonicalJson, fixedClock } from "@budmon/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/platform/observability/logger.js";
import { recordingLogger } from "../../support/platform.js";
import { logCapture } from "../../support/telemetry.js";
import {
  createErasureLog,
  type ErasureLog,
  type ErasureRecord,
} from "../../../src/platform/storage/erasureLog.js";
import { NoErasureHandlerError, replayErasures } from "../../../src/platform/ops/erasureReplay.js";
import { createMemoryObjectStore } from "../../../src/platform/storage/memoryObjectStore.js";
import { keysOf } from "../../support/s10.js";

const U1 = "0190a0b0-1c2d-7e3f-8a4b-000000000001";
const U2 = "0190a0b0-1c2d-7e3f-8a4b-000000000002";
const U3 = "0190a0b0-1c2d-7e3f-8a4b-000000000003";
const T1 = Temporal.Instant.from("2026-10-05T12:00:00Z");
const T2 = Temporal.Instant.from("2026-10-06T08:30:15Z");
const T3 = Temporal.Instant.from("2026-10-07T23:59:59Z");

function logOnMemory() {
  const store = createMemoryObjectStore(fixedClock("2026-10-08T00:00:00Z"));
  return { store, log: createErasureLog(store) };
}

describe("TP-10.6: the erasure log (F-146)", () => {
  it("TP-10.6: three records appended out of order: keys records/<YYYYMMDDTHHMMSSZ>_<userId>.json; listSince(t2) returns those at or after t2, sorted", async () => {
    const { store, log } = logOnMemory();

    await log.append({ userId: U3, erasedAt: T3 });
    await log.append({ userId: U1, erasedAt: T1 });
    await log.append({ userId: U2, erasedAt: T2 });

    expect((await keysOf(store, "erasure-log", "records/")).sort()).toEqual([
      `records/20261005T120000Z_${U1}.json`,
      `records/20261006T083015Z_${U2}.json`,
      `records/20261007T235959Z_${U3}.json`,
    ]);
    const since = await log.listSince(T2);
    expect(since.map((r) => [r.userId, r.erasedAt.toString()])).toEqual([
      [U2, T2.toString()],
      [U3, T3.toString()],
    ]);
  });

  it("TP-10.13x: the body is canonicalJson({ userId, erasedAt })", async () => {
    const { store, log } = logOnMemory();

    await log.append({ userId: U1, erasedAt: T1 });

    expect([...store.snapshot().values()].map((v) => v.body.toString())).toEqual([
      canonicalJson({ userId: U1, erasedAt: T1.toString() }),
    ]);
  });

  it("TP-10.13x: records with the same erasedAt are sorted by userId; listSince(t) includes t itself", async () => {
    const { log } = logOnMemory();

    await log.append({ userId: U2, erasedAt: T1 });
    await log.append({ userId: U1, erasedAt: T1 });

    expect((await log.listSince(T1)).map((r) => r.userId)).toEqual([U1, U2]);
    expect(await log.listSince(T2)).toEqual([]);
  });
});

describe("TP-10.6 (A-305): listSince compares whole seconds", () => {
  it("TP-10.6 (A-305): a record erased at 03:00:00.900Z is included by listSince(03:00:00.700Z), with erasedAt 03:00:00Z", async () => {
    const { log } = logOnMemory();

    await log.append({ userId: U1, erasedAt: Temporal.Instant.from("2026-10-05T03:00:00.900Z") });
    const since = await log.listSince(Temporal.Instant.from("2026-10-05T03:00:00.700Z"));

    expect(since.map((r) => [r.userId, r.erasedAt.toString()])).toEqual([
      [U1, "2026-10-05T03:00:00Z"],
    ]);
  });
});

describe("TP-10.7: replayErasures (F-151)", () => {
  function fakeLog(records: ErasureRecord[]): ErasureLog & { sinces: Temporal.Instant[] } {
    const sinces: Temporal.Instant[] = [];
    return {
      sinces,
      append: () => Promise.resolve(),
      listSince: (since) => {
        sinces.push(since);
        return Promise.resolve(records);
      },
    };
  }
  const two: ErasureRecord[] = [
    { userId: U1, erasedAt: T1 },
    { userId: U2, erasedAt: T2 },
  ];

  it("TP-10.7: a log with 2 records and a handler spy: called in order, {replayed: 2}, one erasure_replayed line {count: 2}", async () => {
    const log = fakeLog(two);
    const handler = vi.fn(() => Promise.resolve());
    const logger = recordingLogger();

    const result = await replayErasures({ log, handler, logger }, T1);

    expect(result).toEqual({ replayed: 2 });
    expect(handler.mock.calls).toEqual([[U1], [U2]]);
    expect(log.sinces.map(String)).toEqual([T1.toString()]);
    expect(logger.lines.filter((l) => l.event === "erasure_replayed").map((l) => l.fields)).toEqual(
      [expect.objectContaining({ fields: { count: 2 } })],
    );
  });

  it("TP-10.7: records with a null handler is NoErasureHandlerError", async () => {
    await expect(
      replayErasures({ log: fakeLog(two), handler: null, logger: recordingLogger() }, T1),
    ).rejects.toBeInstanceOf(NoErasureHandlerError);
  });

  it("TP-10.7: an empty log with a null handler is {replayed: 0}", async () => {
    await expect(
      replayErasures({ log: fakeLog([]), handler: null, logger: recordingLogger() }, T1),
    ).resolves.toEqual({ replayed: 0 });
  });

  it("TP-10.7 (A-354): a handler throwing on the second record: rethrown after 1, logged with count 1", async () => {
    const boom = new Error("handler failed");
    const handler = vi.fn((userId: string) =>
      userId === U2 ? Promise.reject(boom) : Promise.resolve(),
    );
    const logger = recordingLogger();

    await expect(replayErasures({ log: fakeLog(two), handler, logger }, T1)).rejects.toBe(boom);
    expect(handler).toHaveBeenCalledTimes(2);
    // A-295: exactly one error line, with the count completed before the failure and no user id.
    const failed = logger.lines.filter((l) => l.event === "erasure_replay_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.level).toBe("error");
    expect(failed[0]?.fields).toMatchObject({ fields: { count: 1 } });
    expect(JSON.stringify(failed)).not.toContain(U1);
    expect(JSON.stringify(failed)).not.toContain(U2);
  });

  it('TP-10.7 (A-354): with the real F-31 logger, the written line has "count":1 and no dropped field', async () => {
    const boom = new Error("handler failed");
    const handler = vi.fn((userId: string) =>
      userId === U2 ? Promise.reject(boom) : Promise.resolve(),
    );
    const capture = logCapture();
    const logger = createLogger({
      service: "worker",
      release: "v1.2.3",
      level: "info",
      appEnv: "production",
      destination: capture,
    });

    await expect(replayErasures({ log: fakeLog(two), handler, logger }, T1)).rejects.toBe(boom);

    const line = capture.lines().find((l) => l.includes("erasure_replay_failed"));
    expect(line).toBeDefined();
    expect(line).toContain('"count":1');
    expect(line).not.toContain("dropped");
    expect(line).not.toContain(U1);
    expect(line).not.toContain(U2);
  });
});
