// F-164 newCodesIntent (identity LLD A-112): the sign-in prompt's in-memory new-codes request.
// TP-4.51 (a) to (f), plus TP-4.51x. `performance.now()` is spied, so time is exact.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEW_CODES_REQUEST_TTL_MS,
  clearNewCodesRequest,
  newCodesRequested,
  requestNewCodes,
  takeNewCodesRequest,
} from "../../src/identity/settings/newCodesIntent.js";

const T0 = 1_000_000;
let now = T0;

beforeEach(() => {
  now = T0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  // The request is module state: start each test with none.
  clearNewCodesRequest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TP-4.51: newCodesIntent (A-112)", () => {
  it("TP-4.51 (a): requestNewCodes(u1), take with u1 at +1 s → true; a second take → false", () => {
    requestNewCodes("u1");
    now = T0 + 1000;

    expect(takeNewCodesRequest("u1")).toBe(true);
    expect(takeNewCodesRequest("u1")).toBe(false);
  });

  it("TP-4.51 (b): a request for u1 taken with u2 → false, and cleared: a take with u1 then → false", () => {
    requestNewCodes("u1");

    expect(takeNewCodesRequest("u2")).toBe(false);
    expect(takeNewCodesRequest("u1")).toBe(false);
  });

  it("TP-4.51x (b): a take with no signed-in user (undefined) → false, and clears the request", () => {
    requestNewCodes("u1");

    expect(takeNewCodesRequest(undefined)).toBe(false);
    expect(newCodesRequested()).toBe(false);
  });

  it("TP-4.51 (c): a take at +30 s → false", () => {
    requestNewCodes("u1");
    now = T0 + 30_000;

    expect(takeNewCodesRequest("u1")).toBe(false);
  });

  it("TP-4.51x (c): a take 1 ms before 30 s → true (the limit is exclusive)", () => {
    requestNewCodes("u1");
    now = T0 + 29_999;

    expect(takeNewCodesRequest("u1")).toBe(true);
  });

  it("TP-4.51 (d): request, clearNewCodesRequest(), take → false", () => {
    requestNewCodes("u1");

    clearNewCodesRequest();

    expect(newCodesRequested()).toBe(false);
    expect(takeNewCodesRequest("u1")).toBe(false);
  });

  it("TP-4.51 (e): a request for u1 then one for u2: a take with u2 → true", () => {
    requestNewCodes("u1");
    requestNewCodes("u2");

    expect(takeNewCodesRequest("u2")).toBe(true);
  });

  it("TP-4.51x (e): the later request replaces the earlier: a take with u1 → false", () => {
    requestNewCodes("u1");
    requestNewCodes("u2");

    expect(takeNewCodesRequest("u1")).toBe(false);
  });

  it("TP-4.51x (e): the later request restarts the 30 s: requested at +20 s, taken at +40 s → true", () => {
    requestNewCodes("u1");
    now = T0 + 20_000;
    requestNewCodes("u1");
    now = T0 + 40_000;

    expect(takeNewCodesRequest("u1")).toBe(true);
  });

  it("TP-4.51 (f): newCodesRequested() is true after a request and false after a take", () => {
    expect(newCodesRequested()).toBe(false);
    requestNewCodes("u1");
    expect(newCodesRequested()).toBe(true);

    takeNewCodesRequest("u1");

    expect(newCodesRequested()).toBe(false);
  });

  it("TP-4.51x: NEW_CODES_REQUEST_TTL_MS is 30 000", () => {
    expect(NEW_CODES_REQUEST_TTL_MS).toBe(30_000);
  });
});
