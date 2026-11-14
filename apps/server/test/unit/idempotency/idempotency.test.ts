// F-100's request hash and createIdempotency outside a transaction. TP-7.8 (A-233) and TP-7.9.
import { createHash } from "node:crypto";
import { canonicalJson, fixedClock } from "@budmon/shared";
import { describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { observed } from "../../support/api.js";
import { createIdempotency, requestHashOf } from "../../../src/platform/idempotency/idempotency.js";

describe("TP-7.9: idempotency needs a transaction (F-100)", () => {
  it("TP-7.9: run on a handle that isn't in a transaction throws, before any statement or work", async () => {
    const executeSql = vi.fn();
    const h = { inTransaction: false, executeSql, db: {} } as unknown as DbHandle;
    const work = vi.fn();
    const idempotency = createIdempotency({
      clock: fixedClock("2026-10-09T12:00:00Z"),
      metrics: observed().metrics,
    });

    await expect(
      idempotency.run(
        h,
        {
          userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          key: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c",
          procedure: "test.create",
          input: {},
        },
        work,
      ),
    ).rejects.toThrow("idempotency requires a transaction");
    expect(executeSql).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
});

describe("TP-7.8: requestHashOf is canonical (F-100, A-233)", () => {
  it("TP-7.8: {a:1,b:2} and {b:2,a:1} give the same 32-byte hash, sha256(canonicalJson(input))", () => {
    const one = requestHashOf({ a: 1, b: 2 });
    const two = requestHashOf({ b: 2, a: 1 });

    expect(one).toEqual(two);
    expect(one.length).toBe(32);
    expect(one).toEqual(
      createHash("sha256")
        .update(canonicalJson({ a: 1, b: 2 }))
        .digest(),
    );
  });

  it("TP-7.8: different inputs give different hashes", () => {
    expect(requestHashOf({ a: 1, b: 2 })).not.toEqual(requestHashOf({ a: 1, b: 3 }));
    expect(requestHashOf({ a: [1, 2] })).not.toEqual(requestHashOf({ a: [2, 1] }));
  });
});
