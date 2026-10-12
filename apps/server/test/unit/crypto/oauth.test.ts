// F-115 sealed-column registry, F-119 PKCE and the authorisation URL, F-120
// exchangeAuthorizationCode, F-121 egress guard. TP-8.9 to TP-8.13, plus extra cases TP-8.18x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { fixedClock } from "@budmon/shared";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import { createSealedColumnRegistry } from "../../../src/platform/crypto/sealedColumns.js";
import { Secret } from "../../../src/platform/observability/redaction.js";
import {
  CAPTURE_EGRESS_HOSTS,
  createGuardedFetch,
  EgressDeniedError,
} from "../../../src/platform/crypto/egress.js";
import {
  buildGoogleAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
  OAuthExchangeError,
} from "../../../src/platform/crypto/oauth.js";

describe("TP-8.9: the sealed-column registry (F-115)", () => {
  const ok = {
    table: "gmail_accounts",
    idColumn: "id",
    column: "refresh_token",
    purpose: "gmail.refresh",
    provider: "capture" as const,
  };

  it.each([
    ["table Bad-Name", { ...ok, table: "Bad-Name" }],
    ["purpose 'has space'", { ...ok, purpose: "has space" }],
  ])("TP-8.9: %s throws TypeError", (_label, column) => {
    expect(() => {
      createSealedColumnRegistry().register(column);
    }).toThrow(TypeError);
  });

  it("TP-8.9: a duplicate (table, column) throws TypeError", () => {
    const registry = createSealedColumnRegistry();
    registry.register(ok);

    expect(() => {
      registry.register({ ...ok, purpose: "other" });
    }).toThrow(TypeError);
  });

  it("TP-8.18x: all() returns the columns in registration order; the same column of another table is fine", () => {
    const registry = createSealedColumnRegistry();
    const other = { ...ok, table: "sms_devices", provider: "api" as const };
    registry.register(ok);
    registry.register(other);

    expect(registry.all()).toEqual([ok, other]);
  });
});

describe("TP-8.10: PKCE (F-119)", () => {
  // RFC 7636 appendix B: the 32 octets behind the example verifier.
  const RFC_BYTES = Buffer.from([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
    105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
  ]);

  it("TP-8.10: with RFC 7636 appendix B's bytes, the verifier and S256 challenge are the RFC's", () => {
    const pair = createPkcePair((n) => RFC_BYTES.subarray(0, n));

    expect(pair.verifier.reveal()).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(pair.challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(pair.method).toBe("S256");
  });

  it("TP-8.18x: a real verifier is 43 base64url characters; state is a 43-character token; two of each differ", () => {
    const a = createPkcePair();
    const b = createPkcePair();

    expect(a.verifier.reveal()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier.reveal()).not.toBe(b.verifier.reveal());
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});

describe("TP-8.11: the Google authorisation URL (F-119)", () => {
  it("TP-8.11: host, path and exactly the listed parameters", () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: "123.apps.googleusercontent.com",
      redirectUri: "http://localhost:8080/oauth/callback",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", "openid"],
      state: "state-token",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    });

    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "123.apps.googleusercontent.com",
      redirect_uri: "http://localhost:8080/oauth/callback",
      scope: "https://www.googleapis.com/auth/gmail.readonly openid",
      state: "state-token",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    expect([...url.searchParams.keys()]).toHaveLength(10);
  });
});

describe("TP-8.12: exchangeAuthorizationCode (F-120)", () => {
  const NOW = "2026-10-09T12:00:00Z";

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async function exchange(fetchImpl: typeof fetch) {
    return exchangeAuthorizationCode(
      {
        fetch: fetchImpl,
        clientId: "client-id",
        clientSecret: Secret.of("client-secret"),
        clock: fixedClock(NOW),
      },
      {
        code: Secret.of("auth-code"),
        verifier: Secret.of("the-verifier"),
        redirectUri: "http://localhost:8080/oauth/callback",
      },
    );
  }

  async function failure(fetchImpl: typeof fetch) {
    try {
      await exchange(fetchImpl);
    } catch (error) {
      return error as Error & { reason?: unknown; retryable?: unknown };
    }
    throw new Error("expected the exchange to fail");
  }

  it("TP-8.12: a full 200 gives Secret tokens, expiresAt = now + expires_in and the scopes; the request is the token POST with the six form fields", async () => {
    const fakeFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        json(200, {
          access_token: "access-1",
          expires_in: 3599,
          refresh_token: "refresh-1",
          scope: "https://www.googleapis.com/auth/gmail.readonly openid",
          token_type: "Bearer",
        }),
      ),
    );

    const tokens = await exchange(fakeFetch);

    expect(tokens.refreshToken.reveal()).toBe("refresh-1");
    expect(tokens.accessToken.reveal()).toBe("access-1");
    expect(tokens.expiresAt.toString()).toBe("2026-10-09T12:59:59Z");
    expect(tokens.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "openid"]);
    const [url, init] = fakeFetch.mock.calls[0] ?? [];
    expect(url instanceof Request ? url.url : url?.toString()).toBe(
      "https://oauth2.googleapis.com/token",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "auth-code",
      code_verifier: "the-verifier",
      client_id: "client-id",
      client_secret: "client-secret",
      redirect_uri: "http://localhost:8080/oauth/callback",
    });
  });

  it("TP-8.12 (A-262): expires_in 31622400 (366 days, the bound) is accepted", async () => {
    const tokens = await exchange(() =>
      Promise.resolve(
        json(200, {
          access_token: "a",
          refresh_token: "r",
          expires_in: 31622400,
          scope: "openid",
        }),
      ),
    );

    expect(tokens.expiresAt.toString()).toBe("2027-10-10T12:00:00Z");
  });

  const cases: [string, () => Promise<Response>, string, boolean][] = [
    [
      "200 without refresh_token",
      () => Promise.resolve(json(200, { access_token: "a", expires_in: 3600, scope: "openid" })),
      "no_refresh_token",
      false,
    ],
    [
      "400 invalid_grant with a canary description",
      () =>
        Promise.resolve(json(400, { error: "invalid_grant", error_description: CANARIES.message })),
      "invalid_grant",
      false,
    ],
    ["403", () => Promise.resolve(json(403, { error: CANARIES.payee })), "rejected", false],
    ["503", () => Promise.resolve(json(503, { error: CANARIES.payee })), "server", true],
    ["429", () => Promise.resolve(json(429, {})), "server", true],
    [
      "302 with a Location (A-255: not followed)",
      () =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
        ),
      "rejected",
      false,
    ],
    // A-259: every malformed 200 is rejected, not retryable (the code is already consumed).
    [
      "200 with refresh_token but no access_token (A-259)",
      () => Promise.resolve(json(200, { refresh_token: "r", expires_in: 3600, scope: "openid" })),
      "rejected",
      false,
    ],
    [
      "200 without expires_in (A-259)",
      () => Promise.resolve(json(200, { access_token: "a", refresh_token: "r", scope: "openid" })),
      "rejected",
      false,
    ],
    ...([0, -5, "abc", 1e300, 31622401] as const).map(
      (expiresIn): [string, () => Promise<Response>, string, boolean] => [
        `200 with expires_in ${JSON.stringify(expiresIn)} (A-259, A-262)`,
        () =>
          Promise.resolve(
            json(200, {
              access_token: "a",
              refresh_token: "r",
              expires_in: expiresIn,
              scope: "openid",
            }),
          ),
        "rejected",
        false,
      ],
    ),
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), "network", true],
    [
      "a timeout",
      () =>
        Promise.reject(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        ),
      "network",
      true,
    ],
  ];

  it.each(cases)(
    "TP-8.12: %s is OAuthExchangeError %s (retryable %s), with no response content kept",
    async (_label, respond, reason, retryable) => {
      const error = await failure(respond);

      expect(error).toBeInstanceOf(OAuthExchangeError);
      expect(error.reason).toBe(reason);
      expect(error.retryable).toBe(retryable);
      expect(error.message).toBe(reason);
      const text = JSON.stringify({
        ...Object.fromEntries(Object.entries(error)),
        message: error.message,
        stack: error.stack,
      });
      expect(scanForCanaries([{ name: "error", text }], CANARIES)).toEqual([]);
    },
  );
});

describe("TP-8.13: the egress guard (F-121)", () => {
  function guarded() {
    const inner = vi.fn<typeof fetch>(() => Promise.resolve(new Response("ok")));
    return {
      inner,
      fetch: createGuardedFetch(new Set(["gmail.googleapis.com"]), inner),
    };
  }

  it("TP-8.13: an allowed https URL is passed on with redirect manual", async () => {
    const { inner, fetch } = guarded();

    await fetch("https://gmail.googleapis.com/x", { redirect: "follow" });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it.each([
    ["http://gmail.googleapis.com/", "gmail.googleapis.com"],
    ["https://evil.example/", "evil.example"],
    ["https://gmail.googleapis.com:8443/", "gmail.googleapis.com"],
    ["https://u:p@gmail.googleapis.com/", "gmail.googleapis.com"],
  ])("TP-8.13: %s is EgressDeniedError and the inner fetch isn't called", async (url, host) => {
    const { inner, fetch } = guarded();

    const error = await fetch(url).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(EgressDeniedError);
    expect((error as { host: string }).host).toBe(host);
    expect(inner).not.toHaveBeenCalled();
  });

  it("TP-8.18x: port 443 written out is allowed; CAPTURE_EGRESS_HOSTS lists the four Google hosts", async () => {
    const { inner, fetch } = guarded();

    await fetch("https://gmail.googleapis.com:443/y");

    expect(inner).toHaveBeenCalledTimes(1);
    expect([...CAPTURE_EGRESS_HOSTS].sort()).toEqual([
      "cloudkms.googleapis.com",
      "gmail.googleapis.com",
      "oauth2.googleapis.com",
      "pubsub.googleapis.com",
    ]);
  });
});
