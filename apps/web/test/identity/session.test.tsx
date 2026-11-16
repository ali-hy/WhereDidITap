// F-152 session store and SessionProvider, F-153 guards and safeNext, F-154 readFragmentToken
// (identity LLD §4.14). TP-0.28 rows (a) to (m) and its S-3 rows (signOut, sessionEnded), plus
// extra cases TP-0.28x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { render } from "@solidjs/testing-library";
import { isRedirect } from "@tanstack/solid-router";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createSignal, type Accessor } from "solid-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.js";
import { toAppError } from "../../src/api/errors.js";
import { createQueryClient } from "../../src/api/queryClient.js";
import { I18nContext, type I18n } from "../../src/i18n/useI18n.js";
import { readFragmentToken } from "../../src/identity/session/fragment.js";
import { SessionProvider, useSession } from "../../src/identity/session/SessionProvider.js";
import {
  createSessionStore,
  type SessionStatus,
  type SessionStore,
} from "../../src/identity/session/sessionStore.js";
import { requireSignedIn, requireSignedOut, safeNext } from "../../src/identity/routes/guards.js";

const MARKER = "budmon.session";

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

const envelope = (code: string, status: number, message: string) => ({
  defined: true,
  code,
  status,
  message,
});

// ---- MSW: /api/v1/me answers from a script; every request is counted ----

type Answer = "ok" | "unauthenticated" | "network" | "timeout" | "internal";
let script: Answer[] = [];
let meRequests = 0;
const server = setupServer(
  http.get("*/api/v1/me", () => {
    meRequests += 1;
    const next = script.shift() ?? "ok";
    if (next === "network") return HttpResponse.error();
    if (next === "unauthenticated") {
      return HttpResponse.json(envelope("UNAUTHENTICATED", 401, "Authentication required"), {
        status: 401,
      });
    }
    if (next === "internal") {
      return HttpResponse.json(envelope("INTERNAL", 500, "Internal error"), { status: 500 });
    }
    return HttpResponse.json(ME);
  }),
);

/** The client's fetch: a scripted "timeout" rejects with a TimeoutError (counted as a request). */
const scriptedFetch: typeof fetch = (input, init) => {
  if (script[0] === "timeout") {
    script.shift();
    meRequests += 1;
    return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  }
  return globalThis.fetch(input, init);
};

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  script = [];
  meRequests = 0;
});

function mapStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

function store(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
  const navigate = vi.fn<(href: string) => void>();
  const queryClient = createQueryClient();
  const s = createSessionStore({
    api: createApiClient({ buildNumber: 1, fetch: scriptedFetch }),
    queryClient,
    navigate,
    storage,
  });
  return { s, navigate, queryClient };
}

/** No further /me request while 30 s of fake time pass (no automatic retry, review O-8). */
async function noRetryWithin30s(): Promise<void> {
  const before = meRequests;
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(30_000);
  vi.useRealTimers();
  expect(meRequests).toBe(before);
}

describe("TP-0.28: the session store (F-152)", () => {
  it("TP-0.28 (a): boot() with the marker and me.get 200 → signed_in, me set", async () => {
    const storage = mapStorage({ [MARKER]: "1" });
    const { s } = store(storage);

    await s.boot();

    expect(s.status()).toBe("signed_in");
    expect(s.me()).toMatchObject({ id: ME.id, email: ME.email, locale: "en" });
    expect(meRequests).toBe(1);
  });

  it("TP-0.28 (b): boot() with the marker and me.get 401 UNAUTHENTICATED → signed_out, marker removed", async () => {
    const storage = mapStorage({ [MARKER]: "1" });
    const { s } = store(storage);
    script = ["unauthenticated"];

    await s.boot();

    expect(s.status()).toBe("signed_out");
    expect(s.me()).toBeNull();
    expect(storage.map.has(MARKER)).toBe(false);
  });

  it("TP-0.28 (c): boot() without the marker → signed_out at once, no request", async () => {
    const { s } = store(mapStorage());

    await s.boot();

    expect(s.status()).toBe("signed_out");
    expect(meRequests).toBe(0);
  });

  it("TP-0.28 (d): network, then timeout, then a defined 500 INTERNAL → unavailable each time, error() the thrown error, marker kept, one request per probe, no automatic retry; retry() → loading, then signed_in", async () => {
    const storage = mapStorage({ [MARKER]: "1" });
    const { s } = store(storage);
    script = ["network", "timeout", "internal", "ok"];

    await s.boot();
    expect(s.status()).toBe("unavailable");
    expect(toAppError(s.error()).kind).toBe("network");
    expect(meRequests).toBe(1);
    await noRetryWithin30s();

    await s.retry();
    expect(s.status()).toBe("unavailable");
    expect(toAppError(s.error()).kind).toBe("timeout");
    expect(meRequests).toBe(2);
    await noRetryWithin30s();

    await s.retry();
    expect(s.status()).toBe("unavailable");
    expect(toAppError(s.error())).toMatchObject({ kind: "defined", key: "INTERNAL", status: 500 });
    expect(meRequests).toBe(3);
    await noRetryWithin30s();
    expect(storage.map.get(MARKER)).toBe("1");

    const retried = s.retry();
    expect(s.status()).toBe("loading");
    await retried;
    expect(s.status()).toBe("signed_in");
    expect(s.me()).toMatchObject({ id: ME.id });
    expect(meRequests).toBe(4);
  });

  it("TP-0.28 (e): a storage whose methods throw, with me.get 200: it probes and ends signed_in, nothing thrown", async () => {
    const { s } = store(throwingStorage);

    await expect(s.boot()).resolves.toBeUndefined();

    expect(meRequests).toBe(1);
    expect(s.status()).toBe("signed_in");
  });

  it("TP-0.28 (f): markSignedIn() with me.get 200 → the marker set, me.get called, signed_in", async () => {
    const storage = mapStorage();
    const { s } = store(storage);
    await s.boot();
    expect(s.status()).toBe("signed_out");

    await s.markSignedIn();

    expect(storage.map.get(MARKER)).toBe("1");
    expect(meRequests).toBe(1);
    expect(s.status()).toBe("signed_in");
    expect(s.me()).toMatchObject({ id: ME.id });
  });

  it("TP-0.28x: markSignedIn() with me.get failing (network) → unavailable, the marker set", async () => {
    const storage = mapStorage();
    const { s } = store(storage);
    await s.boot();
    script = ["network"];

    await s.markSignedIn();

    expect(storage.map.get(MARKER)).toBe("1");
    expect(s.status()).toBe("unavailable");
  });

  it("TP-0.28 (g): ready() called while loading resolves with the settled status, and called after resolves at once with it", async () => {
    const { s } = store(mapStorage({ [MARKER]: "1" }));
    expect(s.status()).toBe("loading");

    const early = s.ready();
    const booted = s.boot();
    await expect(early).resolves.toBe("signed_in");
    await booted;

    await expect(s.ready()).resolves.toBe("signed_in");
  });

  it("TP-0.28x: ready() while loading, for a boot that ends unavailable, resolves unavailable", async () => {
    const { s } = store(mapStorage({ [MARKER]: "1" }));
    script = ["internal"];

    const early = s.ready();
    await s.boot();

    await expect(early).resolves.toBe("unavailable");
  });
});

// ---- F-153: the guards, against a fake store ----

function fakeStore(initial: SessionStatus, retryTo?: SessionStatus) {
  const [status, setStatus] = createSignal<SessionStatus>(initial);
  const failure = new Error("the probe failed");
  const retry = vi.fn(() => {
    if (retryTo !== undefined) setStatus(retryTo);
    return Promise.resolve();
  });
  const s = {
    status,
    me: () => null,
    error: () => failure,
    endedDuringBoot: () => false,
    ready: () => Promise.resolve(status() as Exclude<SessionStatus, "loading">),
    boot: vi.fn(() => Promise.resolve()),
    retry,
    markSignedIn: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    sessionEnded: vi.fn(),
  } as unknown as SessionStore;
  return { s, failure, retry };
}

async function thrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  return undefined;
}

const redirectOptions = (err: unknown) => {
  expect(isRedirect(err)).toBe(true);
  return (err as { options: { to?: string; search?: unknown } }).options;
};

describe("TP-0.28: the guards (F-153)", () => {
  it("TP-0.28 (h): requireSignedIn, signed_out at /settings → a redirect to /sign-in with search { next: '/settings' }, no reason", async () => {
    const { s } = fakeStore("signed_out");

    const err = await thrown(
      requireSignedIn({ context: { session: s }, location: { pathname: "/settings" } }),
    );

    const options = redirectOptions(err);
    expect(options.to).toBe("/sign-in");
    expect(options.search).toEqual({ next: "/settings" });
  });

  it("TP-0.28 (h): requireSignedIn, signed_out at //evil.com → { next: '/' }", async () => {
    const { s } = fakeStore("signed_out");

    const err = await thrown(
      requireSignedIn({ context: { session: s }, location: { pathname: "//evil.com" } }),
    );

    expect(redirectOptions(err).search).toEqual({ next: "/" });
  });

  it("TP-0.28 (h): requireSignedIn, unavailable and the retry failing again → retry() once, then error()'s error thrown", async () => {
    const { s, failure, retry } = fakeStore("unavailable", "unavailable");

    const err = await thrown(
      requireSignedIn({ context: { session: s }, location: { pathname: "/settings" } }),
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(err).toBe(failure);
  });

  it("TP-0.28 (h): requireSignedIn, unavailable and the retry succeeding → returns", async () => {
    const { s, retry } = fakeStore("unavailable", "signed_in");

    await expect(
      requireSignedIn({ context: { session: s }, location: { pathname: "/settings" } }),
    ).resolves.toBeUndefined();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("TP-0.28 (h): requireSignedIn, signed_in → returns, no retry", async () => {
    const { s, retry } = fakeStore("signed_in");

    await expect(
      requireSignedIn({ context: { session: s }, location: { pathname: "/" } }),
    ).resolves.toBeUndefined();
    expect(retry).not.toHaveBeenCalled();
  });

  it("TP-0.28 (i): requireSignedOut, signed_in at /sign-in → a redirect to /", async () => {
    const { s } = fakeStore("signed_in");

    const err = await thrown(
      requireSignedOut({ context: { session: s }, location: { pathname: "/sign-in" } }),
    );

    expect(redirectOptions(err).to).toBe("/");
  });

  it.each(["unavailable", "signed_out"] as const)(
    "TP-0.28 (i): requireSignedOut, %s → returns",
    async (status) => {
      const { s } = fakeStore(status);

      await expect(
        requireSignedOut({ context: { session: s }, location: { pathname: "/sign-in" } }),
      ).resolves.toBeUndefined();
    },
  );

  it("TP-0.28 (j): safeNext", () => {
    const at200 = `/${"a".repeat(200)}`;
    const at201 = `/${"a".repeat(201)}`;

    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/settings")).toBe("/settings");
    expect(safeNext("/a?b")).toBe("/");
    expect(safeNext("https://x")).toBe("/");
    expect(safeNext(42)).toBe("/");
    expect(safeNext(at200)).toBe(at200);
    expect(safeNext(at201)).toBe("/");
  });

  it("TP-0.28x: safeNext keeps /, underscores and dashes, and refuses a percent sign or a dot", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/settings/security/two-step_x")).toBe("/settings/security/two-step_x");
    expect(safeNext("/a%2F")).toBe("/");
    expect(safeNext("/a/../b")).toBe("/");
  });
});

describe("TP-0.28: readFragmentToken (F-154)", () => {
  it("TP-0.28 (k): location.hash '#t=abc' → 'abc', and location.hash is empty afterwards (path and search kept)", () => {
    history.replaceState(null, "", "/invite?x=1#t=abc");

    expect(readFragmentToken("t")).toBe("abc");
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/invite?x=1");
  });

  it("TP-0.28x: another key, or no fragment → null", () => {
    history.replaceState(null, "", "/invite#h=xyz");
    expect(readFragmentToken("t")).toBeNull();

    history.replaceState(null, "", "/invite");
    expect(readFragmentToken("t")).toBeNull();
  });
});

// ---- SessionProvider ----

function fakeI18n(setLocale: (l: string) => Promise<void>): I18n {
  return {
    locale: () => "en",
    dir: () => "ltr",
    t: (d: { id: string; defaultMessage?: string }) => d.defaultMessage ?? d.id,
    formatMoney: () => "",
    formatDate: () => "",
    formatInstant: () => "",
    formatRelative: () => "",
    setLocale,
  } as unknown as I18n;
}

function storeWithMe(me: Accessor<unknown>): SessionStore {
  return { ...fakeStore("signed_in").s, me } as unknown as SessionStore;
}

describe("TP-0.28: SessionProvider (F-152)", () => {
  it("TP-0.28 (l): setLocale isn't called while me is null, then with 'ar-XB', then with 'en'", () => {
    const setLocale = vi.fn(() => Promise.resolve());
    const [me, setMe] = createSignal<unknown>(null);
    render(() => (
      <I18nContext.Provider value={fakeI18n(setLocale)}>
        <SessionProvider store={storeWithMe(me)}>
          <p>child</p>
        </SessionProvider>
      </I18nContext.Provider>
    ));
    expect(setLocale).not.toHaveBeenCalled();

    setMe({ ...ME, locale: "ar-XB" });
    expect(setLocale).toHaveBeenLastCalledWith("ar-XB");

    setMe({ ...ME, locale: "en" });
    expect(setLocale).toHaveBeenLastCalledWith("en");
    expect(setLocale).toHaveBeenCalledTimes(2);
  });

  it("TP-0.28 (m): without an i18n context it throws 'useI18n needs an I18nProvider'", () => {
    const [me] = createSignal<unknown>(null);

    expect(() =>
      render(() => (
        <SessionProvider store={storeWithMe(me)}>
          <p>child</p>
        </SessionProvider>
      )),
    ).toThrow("useI18n needs an I18nProvider");
  });

  it("TP-0.28x: useSession() inside the provider returns the store", () => {
    const [me] = createSignal<unknown>(null);
    const s = storeWithMe(me);
    let seen: SessionStore | undefined;
    function Child() {
      seen = useSession();
      return null;
    }
    render(() => (
      <I18nContext.Provider value={fakeI18n(() => Promise.resolve())}>
        <SessionProvider store={s}>
          <Child />
        </SessionProvider>
      </I18nContext.Provider>
    ));

    expect(seen).toBe(s);
  });
});

// ---- S-3: signOut and sessionEnded (F-152, F-153) ----

/** A cached query that every cache clear removes. */
const SENTINEL = ["tp-0.28", "sentinel"] as const;

describe("TP-0.28 (S-3): signOut() and sessionEnded() (F-152)", () => {
  /** Answers POST /api/v1/auth/sign-out with `respond`, counting requests. */
  function signOutRoute(respond: () => Response): { readonly n: number } {
    const seen = { n: 0 };
    server.use(
      http.post("*/api/v1/auth/sign-out", () => {
        seen.n += 1;
        return respond();
      }),
    );
    return seen;
  }

  async function signedIn() {
    const storage = mapStorage({ [MARKER]: "1" });
    const made = store(storage);
    await made.s.boot();
    expect(made.s.status()).toBe("signed_in");
    made.queryClient.setQueryData(SENTINEL, 1);
    return { ...made, storage };
  }

  it("TP-0.28 (S-3): signOut() with auth.signOut 200 → signed_out, the marker removed, the query cache cleared, navigate('/sign-in')", async () => {
    const { s, navigate, queryClient, storage } = await signedIn();
    const calls = signOutRoute(() => HttpResponse.json({ ok: true }));

    await s.signOut();

    expect(calls.n).toBe(1);
    expect(s.status()).toBe("signed_out");
    expect(storage.map.has(MARKER)).toBe(false);
    expect(queryClient.getQueryData(SENTINEL)).toBeUndefined();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("TP-0.28x (S-3): signOut() with auth.signOut 401 UNAUTHENTICATED → the same as 200", async () => {
    const { s, navigate, queryClient, storage } = await signedIn();
    signOutRoute(() =>
      HttpResponse.json(envelope("UNAUTHENTICATED", 401, "Authentication required"), {
        status: 401,
      }),
    );

    await s.signOut();

    expect(s.status()).toBe("signed_out");
    expect(storage.map.has(MARKER)).toBe(false);
    expect(queryClient.getQueryData(SENTINEL)).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/sign-in");
  });

  it("TP-0.28 (S-3): signOut() with auth.signOut failing (network) → the error thrown, the status still signed_in, the marker kept", async () => {
    const { s, navigate, storage } = await signedIn();
    signOutRoute(() => HttpResponse.error());

    const err = await thrown(s.signOut());

    expect(err).toBeDefined();
    expect(toAppError(err).kind).toBe("network");
    expect(s.status()).toBe("signed_in");
    expect(storage.map.get(MARKER)).toBe("1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("TP-0.28x (S-3): signOut() with auth.signOut failing (a defined 500 INTERNAL) → thrown, still signed_in, the marker kept", async () => {
    const { s, navigate, storage } = await signedIn();
    signOutRoute(() =>
      HttpResponse.json(envelope("INTERNAL", 500, "Internal error"), { status: 500 }),
    );

    const err = await thrown(s.signOut());

    expect(toAppError(err)).toMatchObject({ kind: "defined", key: "INTERNAL" });
    expect(s.status()).toBe("signed_in");
    expect(storage.map.get(MARKER)).toBe("1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("TP-0.28 (S-3): sessionEnded('/settings') while signed_in → signed_out, the marker removed, the cache cleared, navigate('/sign-in?reason=ended&next=/settings')", async () => {
    const { s, navigate, queryClient, storage } = await signedIn();

    s.sessionEnded("/settings");

    expect(s.status()).toBe("signed_out");
    expect(storage.map.has(MARKER)).toBe(false);
    expect(queryClient.getQueryData(SENTINEL)).toBeUndefined();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/sign-in?reason=ended&next=/settings");
  });

  it("TP-0.28x (S-3): sessionEnded('//evil.com') while signed_in → navigate('/sign-in?reason=ended&next=/') (safeNext)", async () => {
    const { s, navigate } = await signedIn();

    s.sessionEnded("//evil.com");

    expect(navigate).toHaveBeenCalledWith("/sign-in?reason=ended&next=/");
  });

  it("TP-0.28 (S-3): sessionEnded('/settings') during a boot probe whose me.get then answers 401 → the marker removed, the cache cleared, endedDuringBoot() true, no navigate; signed_out once the probe settles; requireSignedIn at /settings redirects with { next: '/settings', reason: 'ended' }; markSignedIn() resets endedDuringBoot()", async () => {
    const storage = mapStorage({ [MARKER]: "1" });
    const { s, navigate, queryClient } = store(storage);
    queryClient.setQueryData(SENTINEL, 1);
    let duringProbe: Record<string, unknown> | undefined;
    server.use(
      http.get(
        "*/api/v1/me",
        () => {
          meRequests += 1;
          s.sessionEnded("/settings");
          duringProbe = {
            status: s.status(),
            endedDuringBoot: s.endedDuringBoot(),
            marker: storage.map.has(MARKER),
            sentinel: queryClient.getQueryData(SENTINEL),
          };
          return HttpResponse.json(envelope("UNAUTHENTICATED", 401, "Authentication required"), {
            status: 401,
          });
        },
        { once: true },
      ),
    );

    await s.boot();

    expect(duringProbe).toEqual({
      status: "loading",
      endedDuringBoot: true,
      marker: false,
      sentinel: undefined,
    });
    expect(s.status()).toBe("signed_out");
    expect(navigate).not.toHaveBeenCalled();

    const err = await thrown(
      requireSignedIn({ context: { session: s }, location: { pathname: "/settings" } }),
    );
    const options = redirectOptions(err);
    expect(options.to).toBe("/sign-in");
    expect(options.search).toEqual({ next: "/settings", reason: "ended" });

    await s.markSignedIn();

    expect(s.status()).toBe("signed_in");
    expect(s.endedDuringBoot()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
