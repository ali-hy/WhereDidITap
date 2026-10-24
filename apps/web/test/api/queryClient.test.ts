// F-204 createQueryClient: retry rules for queries and mutations. TP-11.4, plus extra cases
// TP-11.32x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/solid-query";
import { definedError, loadOrpcClient, loadQueryClient, loadSolidQuery } from "../support/s11b.js";

let client: QueryClient | undefined;

// Load every module before any test fakes timers: a cold dynamic import under fake timers can
// finish after runAllTimersAsync has already run out of timers, so the first retry never fires.
beforeAll(async () => {
  await Promise.all([loadOrpcClient(), loadQueryClient(), loadSolidQuery()]);
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  client?.clear();
  client = undefined;
  vi.useRealTimers();
});

async function newClient(): Promise<QueryClient> {
  const { createQueryClient } = await loadQueryClient();
  client = createQueryClient();
  return client;
}

/** Runs `p` to completion, advancing fake time through every retry delay. */
async function drain<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const settled = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

/** A function failing with each of `failures` in turn, then resolving "ok". */
function failing(failures: readonly (() => Promise<Error>)[]) {
  let calls = 0;
  const fn = vi.fn(async () => {
    const next = failures[calls];
    calls += 1;
    if (next !== undefined) throw await next();
    return "ok";
  });
  return fn;
}

const internal = () => definedError("INTERNAL", 500, { outcome: "not_applied" });
const notFound = () => definedError("NOT_FOUND", 404);
const network = () => Promise.resolve(new TypeError("Failed to fetch"));

describe("TP-11.4: query retries (F-204)", () => {
  it("TP-11.4: 500 ×3 then OK succeeds after 3 retries", async () => {
    const qc = await newClient();
    const queryFn = failing([internal, internal, internal]);

    const result = await drain(qc.query({ queryKey: ["a"], queryFn }));

    expect(result).toEqual({ value: "ok" });
    expect(queryFn).toHaveBeenCalledTimes(4);
  });

  it("TP-11.4: 404 isn't retried", async () => {
    const qc = await newClient();
    const queryFn = failing([notFound]);

    const result = await drain(qc.query({ queryKey: ["b"], queryFn }));

    expect(result.error).toBeDefined();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("TP-11.4: network ×4 errors after 3 retries", async () => {
    const qc = await newClient();
    const queryFn = failing([network, network, network, network]);

    const result = await drain(qc.query({ queryKey: ["c"], queryFn }));

    expect(result.error).toBeInstanceOf(TypeError);
    expect(queryFn).toHaveBeenCalledTimes(4);
  });

  it("TP-11.32x: query defaults: retryDelay 1000 × 2^n, refetchOnWindowFocus true, staleTime 30000", async () => {
    const qc = await newClient();
    const queries = qc.getDefaultOptions().queries ?? {};
    const retryDelay = queries.retryDelay as (n: number, err: unknown) => number;

    expect([0, 1, 2].map((n) => retryDelay(n, new TypeError("x")))).toEqual([1000, 2000, 4000]);
    expect(queries.refetchOnWindowFocus).toBe(true);
    expect(queries.staleTime).toBe(30_000);
  });
});

describe("TP-11.4: mutation retries (F-204)", () => {
  async function mutate(
    meta: Record<string, unknown> | undefined,
    failures: readonly (() => Promise<Error>)[],
  ) {
    const qc = await newClient();
    const { MutationObserver } = await loadSolidQuery();
    const mutationFn = failing(failures);
    const observer = new MutationObserver(qc, { mutationFn, ...(meta ? { meta } : {}) });
    const result = await drain(observer.mutate());
    return { result, mutationFn };
  }

  it("TP-11.4: a mutation 500 without meta isn't retried", async () => {
    const { result, mutationFn } = await mutate(undefined, [internal]);

    expect(result.error).toBeDefined();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it("TP-11.4: a mutation 500 with meta.idempotent is retried", async () => {
    const { result, mutationFn } = await mutate({ idempotent: true }, [internal]);

    expect(result).toEqual({ value: "ok" });
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("TP-11.32x: an idempotent mutation follows the query rule: network ×4 errors after 3 retries; 404 isn't retried", async () => {
    const net = await mutate({ idempotent: true }, [network, network, network, network]);
    expect(net.result.error).toBeInstanceOf(TypeError);
    expect(net.mutationFn).toHaveBeenCalledTimes(4);

    const missing = await mutate({ idempotent: true }, [notFound]);
    expect(missing.result.error).toBeDefined();
    expect(missing.mutationFn).toHaveBeenCalledTimes(1);
  });
});
