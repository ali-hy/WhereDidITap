// F-201 createApiClient and F-202 toAppError. TP-11.1 and TP-11.2, plus extra cases TP-11.32x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { definedError, loadClient, loadErrors } from "../support/s11b.js";

const CLIENT_CONFIG = {
  apiVersion: "1.0",
  android: { minimumVersionCode: 1, latestVersionCode: 1, downloadUrl: null },
  web: { minimumBuild: 0 },
};
const UPDATE_REQUIRED = {
  defined: true,
  code: "CLIENT_UPDATE_REQUIRED",
  status: 400,
  message: "Client update required",
  data: { minimumVersion: 8 },
};

const seen: Headers[] = [];
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => {
  server.close();
});

function answer(status: number, body: unknown): void {
  server.use(
    http.get("*/api/v1/meta/client-config", ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
}

async function settle(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("TP-11.1: createApiClient (F-201)", () => {
  it("TP-11.1: any call sends X-Budmon-Client: web/<buildNumber> and a traceparent 00-<32 hex>-<16 hex>-01", async () => {
    const { createApiClient } = await loadClient();
    answer(200, CLIENT_CONFIG);
    const client = createApiClient({ buildNumber: 7 });

    await client.meta.clientConfig();
    await client.meta.clientConfig();

    expect(seen).toHaveLength(2);
    expect(seen[0]?.get("x-budmon-client")).toBe("web/7");
    expect(seen[0]?.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    // A new trace per call.
    expect(seen[1]?.get("traceparent")).not.toBe(seen[0]?.get("traceparent"));
  });

  it("TP-11.1: a CLIENT_UPDATE_REQUIRED response calls onClientUpdateRequired once", async () => {
    const { createApiClient } = await loadClient();
    answer(400, UPDATE_REQUIRED);
    const onClientUpdateRequired = vi.fn();
    const client = createApiClient({ buildNumber: 7, onClientUpdateRequired });

    const err = await settle(client.meta.clientConfig());

    expect(err).toBeDefined();
    expect(onClientUpdateRequired).toHaveBeenCalledTimes(1);
  });

  it("TP-11.32x: another defined error doesn't call onClientUpdateRequired", async () => {
    const { createApiClient } = await loadClient();
    answer(404, { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" });
    const onClientUpdateRequired = vi.fn();
    const client = createApiClient({ buildNumber: 7, onClientUpdateRequired });

    await settle(client.meta.clientConfig());

    expect(onClientUpdateRequired).not.toHaveBeenCalled();
  });

  // T-1: the 15 s timeout is combined with the caller's signal (A-327).
  it("TP-11.1 (A-327): the fetch gets a new signal combining AbortSignal.timeout(15000) with the request's", async () => {
    const { createApiClient } = await loadClient();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const seenInit: { request: Request | undefined; signal: AbortSignal | null | undefined }[] = [];
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        seenInit.push({
          request: input instanceof Request ? input : undefined,
          signal: init?.signal,
        });
        return Promise.resolve(Response.json(CLIENT_CONFIG));
      },
    });
    let timeoutCalls: unknown[][];
    try {
      await client.meta.clientConfig();
    } finally {
      // mockRestore clears the recorded calls, so they're read first.
      timeoutCalls = [...timeout.mock.calls];
      timeout.mockRestore();
    }

    expect(timeoutCalls).toContainEqual([15_000]);
    expect(seenInit).toHaveLength(1);
    const [call] = seenInit;
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    expect(call?.signal).not.toBe(call?.request?.signal);
    expect(call?.signal?.aborted).toBe(false);
  });

  it("TP-11.1 (A-327): aborting the caller's signal aborts the fetch", async () => {
    const { createApiClient } = await loadClient();
    const caller = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        });
      },
    });

    const call = settle(client.meta.clientConfig(undefined, { signal: caller.signal }));
    await vi.waitFor(() => {
      expect(fetchSignal).toBeInstanceOf(AbortSignal);
    });
    caller.abort();
    await call;

    expect(fetchSignal?.aborted).toBe(true);
  });

  it("TP-11.1 (A-327): a fetch that never settles fails as timeout when the timeout signal fires", async () => {
    const { createApiClient } = await loadClient();
    const { toAppError } = await loadErrors();
    const fire = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(fire.signal);
    let fetching = false;
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () => {
            reject(signal?.reason as Error);
          };
          if (signal?.aborted === true) fail();
          signal?.addEventListener("abort", fail);
          fetching = true;
        }),
    });
    try {
      const call = settle(client.meta.clientConfig());
      await vi.waitFor(() => {
        expect(fetching).toBe(true);
      });
      fire.abort(new DOMException("The operation timed out.", "TimeoutError"));
      const err = await call;

      expect(toAppError(err)).toEqual({ kind: "timeout" });
    } finally {
      timeout.mockRestore();
    }
  });

  // A-398: a failed response's X-Request-Id travels on the thrown error.
  it("TP-11.1 (A-398): a 500 with X-Request-Id leaves requestId (non-enumerable) on the thrown error", async () => {
    const { createApiClient } = await loadClient();
    const id = "4bf92f3577b34da6a3ce929d0e0e4736";
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: () =>
        Promise.resolve(
          Response.json(
            { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "Internal" },
            { status: 500, headers: { "x-request-id": id } },
          ),
        ),
    });

    const err = await settle(client.meta.clientConfig());

    expect((err as { requestId?: unknown }).requestId).toBe(id);
    expect(Object.keys(err as object)).not.toContain("requestId");
  });

  it("TP-11.1 (A-398): a network error carries no requestId", async () => {
    const { createApiClient } = await loadClient();
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    const err = await settle(client.meta.clientConfig());

    expect(err).toBeDefined();
    expect((err as { requestId?: unknown }).requestId).toBeUndefined();
  });

  it("TP-11.32x: the injected fetch is used, with credentials same-origin, at baseUrl", async () => {
    const { createApiClient } = await loadClient();
    const calls: { url: string; credentials: RequestCredentials | undefined }[] = [];
    const fakeFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      calls.push({ url, credentials: init?.credentials });
      return Promise.resolve(Response.json(CLIENT_CONFIG));
    });
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: fakeFetch,
    });

    await client.meta.clientConfig();

    expect(calls).toEqual([
      { url: "https://budmon.test/api/v1/meta/client-config", credentials: "same-origin" },
    ]);
  });
});

describe("TP-11.2: toAppError (F-202)", () => {
  /** The error the client throws for `response` (through an injected fetch). */
  async function thrownFor(response: () => Response | Promise<Response>): Promise<unknown> {
    const { createApiClient } = await loadClient();
    const client = createApiClient({
      buildNumber: 7,
      baseUrl: "https://budmon.test/api/v1",
      fetch: () => Promise.resolve(response()),
    });
    return settle(client.meta.clientConfig());
  }

  it("TP-11.2: a defined error envelope is { kind: defined, key, status, data }", async () => {
    const { toAppError } = await loadErrors();
    const err = await thrownFor(() =>
      Response.json(
        {
          defined: true,
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many requests",
          data: { retryAfterSeconds: 125 },
        },
        { status: 429 },
      ),
    );

    expect(toAppError(err)).toEqual({
      kind: "defined",
      key: "RATE_LIMITED",
      status: 429,
      data: { retryAfterSeconds: 125 },
    });
  });

  it("TP-11.2: an ORPCError with defined: true is defined", async () => {
    const { toAppError } = await loadErrors();

    expect(toAppError(await definedError("NOT_FOUND", 404))).toMatchObject({
      kind: "defined",
      key: "NOT_FOUND",
      status: 404,
    });
  });

  it.each([502, 504])("TP-11.2: a non-envelope %i HTML response is unavailable", async (status) => {
    const { toAppError } = await loadErrors();
    const err = await thrownFor(
      () =>
        new Response("<html><body>Bad Gateway</body></html>", {
          status,
          headers: { "content-type": "text/html" },
        }),
    );

    expect(toAppError(err)).toEqual({ kind: "unavailable" });
  });

  it("TP-11.32x: a non-envelope 503 HTML response is unavailable", async () => {
    const { toAppError } = await loadErrors();
    const err = await thrownFor(
      () => new Response("maintenance", { status: 503, headers: { "content-type": "text/html" } }),
    );

    expect(toAppError(err)).toEqual({ kind: "unavailable" });
  });

  it('TP-11.2: TypeError("Failed to fetch") is network', async () => {
    const { toAppError } = await loadErrors();

    expect(toAppError(new TypeError("Failed to fetch"))).toEqual({ kind: "network" });
  });

  it("TP-11.32x: any error while navigator.onLine is false is network", async () => {
    const { toAppError } = await loadErrors();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(toAppError(new Error("anything"))).toEqual({ kind: "network" });
    } finally {
      onLine.mockRestore();
    }
  });

  it("TP-11.2: a timeout abort (AbortSignal.timeout's TimeoutError) is timeout", async () => {
    const { toAppError } = await loadErrors();
    const signal = AbortSignal.timeout(1);
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        resolve();
      });
    });

    expect(toAppError(signal.reason)).toEqual({ kind: "timeout" });
  });

  it.each([
    ["a bare DOMException TimeoutError", () => new DOMException("t", "TimeoutError"), "timeout"],
    [
      "an Error whose cause is that TimeoutError",
      () => new Error("wrapped", { cause: new DOMException("t", "TimeoutError") }),
      "timeout",
    ],
    [
      "a TimeoutError three causes deep",
      () =>
        new Error("1", {
          cause: new Error("2", {
            cause: new Error("3", { cause: new DOMException("t", "TimeoutError") }),
          }),
        }),
      "timeout",
    ],
    [
      "a TimeoutError four causes deep (past the bound)",
      () =>
        new Error("1", {
          cause: new Error("2", {
            cause: new Error("3", {
              cause: new Error("4", { cause: new DOMException("t", "TimeoutError") }),
            }),
          }),
        }),
      "unknown",
    ],
    ["a DOMException AbortError", () => new DOMException("a", "AbortError"), "unknown"],
  ] as const)("TP-11.2 (A-327): %s is %s", async (_label, make, kind) => {
    const { toAppError } = await loadErrors();

    expect(toAppError(make())).toEqual({ kind });
  });

  it.each([
    ["a valid 32-hex id is kept", "4bf92f3577b34da6a3ce929d0e0e4736", true],
    ['"x" is dropped', "x", false],
    ["upper-case hex is dropped", "4BF92F3577B34DA6A3CE929D0E0E4736", false],
  ] as const)("TP-11.2 (A-398): requestId: %s", async (_label, id, kept) => {
    const { toAppError } = await loadErrors();
    const err = await thrownFor(() =>
      Response.json(
        { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" },
        { status: 404, headers: { "x-request-id": id } },
      ),
    );

    const appError = toAppError(err);
    expect(appError).toMatchObject({ kind: "defined", key: "NOT_FOUND" });
    if (kept) expect(appError).toHaveProperty("requestId", id);
    else expect(appError).not.toHaveProperty("requestId");
  });

  it("TP-11.2: anything else is unknown", async () => {
    const { toAppError } = await loadErrors();

    expect(toAppError(new Error("random"))).toEqual({ kind: "unknown" });
    expect(toAppError("random")).toEqual({ kind: "unknown" });
    expect(toAppError(undefined)).toEqual({ kind: "unknown" });
  });
});
