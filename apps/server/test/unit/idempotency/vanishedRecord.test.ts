// F-100 when the conflicting record vanishes before `find` (A-239). TP-7.16, with the repository
// replaced by a fake (vi.mock of idempotencyRepo).
import { fixedClock, Temporal } from "@budmon/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { IdempotencyKeyReusedError } from "../../../src/platform/errors/platformErrors.js";
import { createIdempotency } from "../../../src/platform/idempotency/idempotency.js";
import * as repo from "../../../src/platform/idempotency/idempotencyRepo.js";
import { observed } from "../../support/api.js";

vi.mock("../../../src/platform/idempotency/idempotencyRepo.js", () => ({
  insertIfAbsent: vi.fn(),
  find: vi.fn(),
  complete: vi.fn(),
}));

const insertIfAbsent = vi.mocked(repo.insertIfAbsent);
const find = vi.mocked(repo.find);
const complete = vi.mocked(repo.complete);

const h = { inTransaction: true, executeSql: vi.fn(), db: {} } as unknown as DbHandle;
const req = {
  userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
  key: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c",
  procedure: "test.create",
  input: { a: 1 },
};
const created = {
  id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d",
  createdAt: Temporal.Instant.from("2026-10-09T12:00:00Z"),
};

function idempotency() {
  return createIdempotency({
    clock: fixedClock("2026-10-09T12:00:00Z"),
    metrics: observed().metrics,
  });
}

beforeEach(() => {
  insertIfAbsent.mockReset();
  find.mockReset();
  complete.mockReset();
  complete.mockResolvedValue(undefined);
});

describe("TP-7.16: a conflicting record that vanishes before find (F-100, A-239)", () => {
  it("TP-7.16: insert conflicts, find returns null, the retry insert succeeds: work runs once, replayed false, no 409", async () => {
    insertIfAbsent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    find.mockResolvedValue(null);
    const work = vi.fn(() => Promise.resolve(created));

    const out = await idempotency().run(h, req, work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(out.replayed).toBe(false);
    expect(out.status).toBe(201);
    expect(out.result).toEqual(created);
    expect(insertIfAbsent).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("TP-7.16: both inserts conflict and find returns null twice: Error 'idempotency record vanished', work never runs", async () => {
    insertIfAbsent.mockResolvedValue(false);
    find.mockResolvedValue(null);
    const work = vi.fn(() => Promise.resolve(created));

    const error = await idempotency()
      .run(h, req, work)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IdempotencyKeyReusedError);
    expect((error as Error).message).toBe("idempotency record vanished");
    expect(work).not.toHaveBeenCalled();
    expect(insertIfAbsent).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenCalledTimes(2);
  });
});
