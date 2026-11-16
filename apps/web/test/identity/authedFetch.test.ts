// F-150 createAuthedFetch and F-151 refreshWebSession (identity LLD §4.14). TP-0.27, plus extra
// cases TP-0.27x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.js";
import { toAppError } from "../../src/api/errors.js";
import { createAuthedFetch } from "../../src/identity/session/authedFetch.js";
import { refreshWebSession } from "../../src/identity/session/refresh.js";

const envelope = (code: string, status: number, message: string) => ({
  defined: true,
  code,
  status,
  message,
});

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const unauthenticated = () =>
  json(envelope("UNAUTHENTICATED", 401, "Authentication required"), 401);
const ok = (body: unknown = { ok: true }) => json(body, 200);

/** A fake LockManager: runs callbacks one at a time and records the lock names. */
function fakeLocks() {
  const names: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const request = (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const callback = (typeof a === "function" ? a : b) as (lock: unknown) => Promise<unknown>;
    names.push(name);
    const run = chain.then(() => callback({ name, mode: "exclusive" }));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return { locks: { request } as unknown as LockManager, names };
}

interface SeenCall {
  url: string;
  method: string;
  body: string;
  init: RequestInit | undefined;
}

/** The inner fetch: records each call (its body read in full) and answers with `answer(n)`. */
function innerFetch(answer: (call: SeenCall, n: number) => Response) {
  const calls: SeenCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const call = { url: req.url, method: req.method, body: await req.text(), init };
    calls.push(call);
    return answer(call, calls.length);
  });
  return { inner: fn as unknown as typeof fetch, calls };
}

/** What P-F-201 passes as the second argument. */
const INIT: RequestInit = { credentials: "same-origin" };

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("TP-0.27: createAuthedFetch (F-150)", () => {
  it("TP-0.27: 401 UNAUTHENTICATED on /api/v1/me with refresh → true: the request is retried once with the same body and init, under the 'budmon-refresh' lock, and the retry's response is returned", async () => {
    const { locks, names } = fakeLocks();
    const { inner, calls } = innerFetch((_c, n) => (n === 1 ? unauthenticated() : ok({ id: 7 })));
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me", { name: "Mona" }), INIT);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      url: "http://localhost/api/v1/me",
      method: "POST",
      body: JSON.stringify({ name: "Mona" }),
    });
    expect(calls[0]?.body).toBe(JSON.stringify({ name: "Mona" }));
    expect(calls[1]?.init).toEqual(INIT);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(names).toEqual(["budmon-refresh"]);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("TP-0.27: 401 UNAUTHENTICATED with refresh → false: onSessionEnded is called and the original 401 is returned (no retry)", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(() => unauthenticated());
    const refresh = vi.fn(() => Promise.resolve(false));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me", {}), INIT);

    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("UNAUTHENTICATED");
    expect(calls).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("TP-0.27: 401 UNAUTHENTICATED on /api/v1/auth/sign-in is returned untouched: no refresh, no retry, no session end", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(() => unauthenticated());
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/auth/sign-in", { email: "a@b.co" }), INIT);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("UNAUTHENTICATED");
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("TP-0.27: a 403 is returned untouched", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(() => json(envelope("FORBIDDEN", 403, "Forbidden"), 403));
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me", {}), INIT);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("FORBIDDEN");
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("TP-0.27: two concurrent 401s make one refresh call, and both requests are retried and succeed", async () => {
    const { locks } = fakeLocks();
    const seen = new Set<string>();
    const { inner, calls } = innerFetch((call) => {
      if (seen.has(call.url)) return ok({ url: call.url });
      seen.add(call.url);
      return unauthenticated();
    });
    const gate = deferred<boolean>();
    const refresh = vi.fn(() => gate.promise);
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const first = authed(post("/api/v1/me", {}), INIT);
    const second = authed(post("/api/v1/me/sessions", {}), INIT);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
      expect(refresh).toHaveBeenCalled();
    });
    gate.resolve(true);
    const [a, b] = await Promise.all([first, second]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(calls).toHaveLength(4);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("TP-0.27x: a 401 whose code isn't UNAUTHENTICATED (INVALID_CREDENTIALS from me.confirm) is returned untouched", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(() =>
      json(envelope("INVALID_CREDENTIALS", 401, "Invalid credentials"), 401),
    );
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me/confirm", { password: "x" }), INIT);

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("TP-0.27x: a 401 without a JSON envelope is returned untouched", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(
      () =>
        new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me", {}), INIT);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("TP-0.27x: refresh → true but the retry answers 401 again: that response is returned, with no second refresh or retry and no session end", async () => {
    const { locks } = fakeLocks();
    const { inner, calls } = innerFetch(() => unauthenticated());
    const refresh = vi.fn(() => Promise.resolve(true));
    const onSessionEnded = vi.fn();
    const authed = createAuthedFetch(inner, { refresh, onSessionEnded, locks });

    const res = await authed(post("/api/v1/me", {}), INIT);

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });
});

// ---- MSW: the real API client over F-150, and F-151 ----

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const ME = {
  id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a01",
  email: "mona@example.com",
  displayName: "Mona Hassan",
  locale: "en",
  timeZone: "Africa/Cairo",
  baseCurrency: "EGP",
  status: "active",
  deletionScheduledFor: null,
  isOwner: false,
  hasPassword: true,
  passwordUpdatedAt: "2026-11-01T10:00:00.000Z",
  google: null,
  twoStep: { enabled: false, recoveryCodesLeft: 0, codesAcknowledged: false },
  confirmedUntil: null,
  sessionId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a02",
};

describe("TP-0.27x: F-150 inside P-F-201's client", () => {
  it("TP-0.27x: createApiClient({ fetch: createAuthedFetch(…) }): me.get answering 401 then 200 resolves with me after one refresh", async () => {
    let meCalls = 0;
    server.use(
      http.get("*/api/v1/me", () => {
        meCalls += 1;
        return meCalls === 1
          ? HttpResponse.json(envelope("UNAUTHENTICATED", 401, "Authentication required"), {
              status: 401,
            })
          : HttpResponse.json(ME);
      }),
    );
    const { locks } = fakeLocks();
    const refresh = vi.fn(() => Promise.resolve(true));
    const api = createApiClient({
      buildNumber: 1,
      fetch: createAuthedFetch(globalThis.fetch.bind(globalThis), {
        refresh,
        onSessionEnded: vi.fn(),
        locks,
      }),
    });

    const me = await api.me.get();

    expect(me).toMatchObject({ id: ME.id });
    expect(meCalls).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("TP-0.27x: refreshWebSession (F-151)", () => {
  /** Answers /api/v1/auth/refresh with `respond`, recording each request's header and body. */
  function refreshRoute(respond: () => Response) {
    const seen: { client: string | null; body: unknown }[] = [];
    server.use(
      http.post("*/api/v1/auth/refresh", async ({ request }) => {
        seen.push({ client: request.headers.get("X-Budmon-Client"), body: await request.json() });
        return respond();
      }),
    );
    return seen;
  }

  it("TP-0.27x: 200 → true; sends { tokenDelivery: 'cookie' } with X-Budmon-Client web/<n>", async () => {
    const seen = refreshRoute(() =>
      HttpResponse.json({ tokens: null, accessExpiresAt: "2026-11-16T10:15:00.000Z" }),
    );

    const result = await refreshWebSession(createApiClient({ buildNumber: 7 }));

    expect(result).toBe(true);
    expect(seen).toEqual([{ client: "web/7", body: { tokenDelivery: "cookie" } }]);
  });

  it("TP-0.27x: 401 REFRESH_INVALID → false", async () => {
    refreshRoute(() =>
      HttpResponse.json(envelope("REFRESH_INVALID", 401, "Refresh token invalid"), {
        status: 401,
      }),
    );

    await expect(refreshWebSession(createApiClient({ buildNumber: 7 }))).resolves.toBe(false);
  });

  it("TP-0.27x: 401 UNAUTHENTICATED → false", async () => {
    refreshRoute(() =>
      HttpResponse.json(envelope("UNAUTHENTICATED", 401, "Authentication required"), {
        status: 401,
      }),
    );

    await expect(refreshWebSession(createApiClient({ buildNumber: 7 }))).resolves.toBe(false);
  });

  it("TP-0.27x: a network error is thrown (P-F-202 kind network)", async () => {
    refreshRoute(() => HttpResponse.error());

    const err: unknown = await refreshWebSession(createApiClient({ buildNumber: 7 })).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeDefined();
    expect(toAppError(err).kind).toBe("network");
  });
});
