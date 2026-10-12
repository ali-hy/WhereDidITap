// F-205 createCreateMutation: idempotency keys across automatic and manual retries. TP-11.5, plus
// extra cases TP-11.32x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// Real timers: the automatic retries wait for F-204's delays (about 7 s in all).
import { render } from "@solidjs/testing-library";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CreateMutationResult,
  type QueryClient,
  loadCreateMutation,
  loadQueryClient,
  loadSolidQuery,
} from "../support/s11b.js";

interface Input {
  name: string;
  amount: number;
}

const URL_ = "https://budmon.test/api/v1/things";
const keys: string[] = [];
/** Every request as (input name, key), in arrival order (B-1). */
const sent: { name: string; key: string }[] = [];
let failuresLeft = 0;
const server = setupServer(
  http.post(URL_, async ({ request }) => {
    const key = request.headers.get("idempotency-key") ?? "";
    keys.push(key);
    sent.push({ name: ((await request.json()) as { name: string }).name, key });
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return HttpResponse.error();
    }
    return HttpResponse.json({
      id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
      createdAt: "2026-10-07T12:00:00Z",
    });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  keys.length = 0;
  sent.length = 0;
  failuresLeft = 0;
});
afterAll(() => {
  server.close();
});

async function mutationFn(input: Input, idempotencyKey: string) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(input),
  });
  return (await res.json()) as { id: string; createdAt: string };
}

const INVALIDATE = [["things"], ["totals", "2026-10"]] as const;

async function setup(): Promise<{ qc: QueryClient; mutation: CreateMutationResult<Input> }> {
  const { createQueryClient } = await loadQueryClient();
  const { QueryClientProvider } = await loadSolidQuery();
  const { createCreateMutation } = await loadCreateMutation();
  const qc = createQueryClient();
  let mutation: CreateMutationResult<Input> | undefined;
  function Probe() {
    mutation = createCreateMutation<Input>({ mutationFn, invalidate: INVALIDATE });
    return null;
  }
  render(() => (
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>
  ));
  if (mutation === undefined) throw new Error("createCreateMutation returned nothing");
  return { qc, mutation };
}

async function attempt(m: CreateMutationResult<Input>, input: Input): Promise<boolean> {
  try {
    await m.mutateAsync(input);
    return true;
  } catch {
    return false;
  }
}

const A: Input = { name: "groceries", amount: 1250 };
const B: Input = { name: "rent", amount: 900_00 };

describe("TP-11.5: createCreateMutation (F-205)", () => {
  it("TP-11.5: mutate(A) failing by network keeps one key across its automatic retries and a manual retry with identical input; mutate(B) after a success gets a new key; success invalidates the listed queries", async () => {
    const { qc, mutation } = await setup();
    for (const key of INVALIDATE) qc.setQueryData(key, "cached");
    // F-204: an idempotent mutation is retried 3 times on network errors.
    failuresLeft = 4;

    expect(await attempt(mutation, A)).toBe(false);
    expect(keys).toHaveLength(4);
    // The manual Try again, with the same input (a copy, not the same object).
    expect(await attempt(mutation, { ...A })).toBe(true);
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    for (const key of INVALIDATE) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);

    expect(await attempt(mutation, B)).toBe(true);
    expect(keys).toHaveLength(6);
    expect(keys[5]).not.toBe(keys[0]);
  }, 30_000);

  it("TP-11.32x: after a failed mutate(A), mutate(B) (changed input) gets a new key", async () => {
    const { mutation } = await setup();
    failuresLeft = 4;

    expect(await attempt(mutation, A)).toBe(false);
    expect(await attempt(mutation, B)).toBe(true);

    expect(keys).toHaveLength(5);
    expect(keys[4]).not.toBe(keys[0]);
  }, 30_000);

  it("TP-11.32x: after a successful mutate(A), the same input again gets a new key", async () => {
    const { mutation } = await setup();

    expect(await attempt(mutation, A)).toBe(true);
    expect(await attempt(mutation, A)).toBe(true);

    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("TP-11.32x: input compared canonically: the same fields in another order reuse the key after a failure", async () => {
    const { mutation } = await setup();
    failuresLeft = 4;

    expect(await attempt(mutation, A)).toBe(false);
    expect(await attempt(mutation, { amount: A.amount, name: A.name })).toBe(true);

    expect(new Set(keys).size).toBe(1);
  }, 30_000);

  // B-1: a call's automatic retries keep that call's key, even after a newer mutate.
  it("TP-11.32x (B-1): mutate(B) while A's automatic retry is pending: every request for A carries A's key", async () => {
    failuresLeft = 1;
    const { mutation } = await setup();

    mutation.mutate({ name: "A", amount: 1 });
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    mutation.mutate({ name: "B", amount: 2 });
    await vi.waitFor(
      () => {
        expect(sent.filter((r) => r.name === "A")).toHaveLength(2);
        expect(sent.filter((r) => r.name === "B")).toHaveLength(1);
      },
      { timeout: 8_000 },
    );

    const aKeys = new Set(sent.filter((r) => r.name === "A").map((r) => r.key));
    const bKeys = new Set(sent.filter((r) => r.name === "B").map((r) => r.key));
    expect(aKeys.size).toBe(1);
    expect(bKeys.size).toBe(1);
    expect([...aKeys][0]).not.toBe([...bKeys][0]);
  }, 15_000);
});
