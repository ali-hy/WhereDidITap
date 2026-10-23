// F-196 fake Google (A-24, A-441): Gmail control modes, the control server's answers, the sign-in
// token branch, its RS256 id_token and the JWKS. TP-16.2. The fake answers by Host over HTTPS; its
// certificate here is a throwaway self-signed one with the four Google names as SANs.
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { CANARIES } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFakeGoogle, type Closable, type FakeGoogleModule } from "./support/load.js";
import { freePort, httpTo, httpsTo, json, selfSigned } from "./support/net.js";

const CLIENT_ID = "rehearsal-signin.apps.googleusercontent.com";
const HOSTS = [
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "gmail.googleapis.com",
  "pubsub.googleapis.com",
];

let m: FakeGoogleModule;
let fake: Closable | undefined;
let port = 0;
let controlPort = 0;
let cert: Buffer;
let publicJwk: JsonWebKey;

const google = (host: string, method: string, urlPath: string, form?: Record<string, string>) =>
  httpsTo(
    port,
    cert,
    host,
    method,
    urlPath,
    form === undefined
      ? undefined
      : { type: "application/x-www-form-urlencoded", text: new URLSearchParams(form).toString() },
  );
const control = (mode: string) => httpTo(controlPort, "POST", "/__control", json({ mode }));
const gmailToken = () =>
  google("oauth2.googleapis.com", "POST", "/token", {
    grant_type: "authorization_code",
    code: "gmail-code",
    client_id: "gmail-client.apps.googleusercontent.com",
  });
const signInToken = (code: string) =>
  google("oauth2.googleapis.com", "POST", "/token", {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
  });
const b64url = (part: string) => Buffer.from(part, "base64url");
const GMAIL_OK = {
  access_token: CANARIES.token,
  refresh_token: `${CANARIES.token}-r`,
  expires_in: 3599,
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  token_type: "Bearer",
};

beforeAll(async () => {
  m = await loadFakeGoogle();
  const tls = selfSigned(HOSTS);
  cert = tls.cert;
  const keyPair = m.generateSignInKeyPair();
  publicJwk = keyPair.publicKey.export({ format: "jwk" });
  port = await freePort();
  controlPort = await freePort();
  fake = await m.startFakeGoogle({
    tls,
    port,
    controlPort,
    canaries: CANARIES,
    signInClientId: CLIENT_ID,
    signInKeyPair: keyPair,
  });
}, 60_000);

afterAll(async () => {
  await fake?.close();
});

describe("TP-16.2: exports (A-24)", () => {
  it("TP-16.2: FAKE_SIGNIN_KID and fakeSignInCode", () => {
    expect(m.FAKE_SIGNIN_KID).toBe("fake-signin-1");
    expect(m.fakeSignInCode("n-1")).toBe(`signin.${Buffer.from("n-1").toString("base64url")}`);
  });

  it("TP-16.2: generateSignInKeyPair is RSA-2048", () => {
    const { publicKey } = m.generateSignInKeyPair();
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });
});

describe("TP-16.2: Gmail token branch under each control mode (A-441)", () => {
  it("TP-16.2: the initial mode is ok: 200 with the canary tokens", async () => {
    const r = await gmailToken();

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(GMAIL_OK);
  });

  it.each(["ok", "invalid_grant", "server_error", "gaxios_error"])(
    "TP-16.2: POST /__control %s → 200 application/json {mode}",
    async (mode) => {
      const r = await control(mode);
      await control("ok");

      expect(r.status).toBe(200);
      expect(String(r.headers["content-type"])).toMatch(/^application\/json/);
      expect(JSON.parse(r.body)).toEqual({ mode });
    },
  );

  it("TP-16.2: invalid_grant → 400 with canaries.message as error_description", async () => {
    await control("invalid_grant");
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({
      error: "invalid_grant",
      error_description: CANARIES.message,
    });
  });

  it("TP-16.2: server_error → 500 with the exact JSON", async () => {
    await control("server_error");
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({
      error: "server_error",
      error_description: CANARIES.token,
    });
  });

  it("TP-16.2: gaxios_error → 502 text/html with the exact body", async () => {
    await control("gaxios_error");
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(502);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.body).toBe(
      `<html><body>upstream error ${CANARIES.token} ${CANARIES.message}</body></html>`,
    );
  });

  it("TP-16.2: {mode: bogus} and a non-JSON body → 400 invalid_mode, and the mode stays ok", async () => {
    await control("ok");
    const bogus = await control("bogus");
    const notJson = await httpTo(controlPort, "POST", "/__control", {
      type: "application/json",
      text: "{mode:",
    });
    const next = await gmailToken();

    for (const r of [bogus, notJson]) {
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: "invalid_mode" });
    }
    expect(next.status).toBe(200);
    expect(JSON.parse(next.body)).toEqual(GMAIL_OK);
  });

  it("TP-16.2: a non-JSON body after server_error leaves server_error in place", async () => {
    await control("server_error");
    await httpTo(controlPort, "POST", "/__control", { type: "text/plain", text: "x" });
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(500);
  });

  it("TP-16.2: GET /__control → 404 not_found", async () => {
    const r = await httpTo(controlPort, "GET", "/__control");

    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: "not_found" });
  });
});

describe("TP-16.2: sign-in token branch", () => {
  it("TP-16.2: fakeSignInCode('n-1') → 200 with the exact body and a verifying id_token", async () => {
    const r = await signInToken(m.fakeSignInCode("n-1"));
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["access_token", "expires_in", "id_token", "scope", "token_type"].sort(),
    );
    expect(body).toMatchObject({
      access_token: CANARIES.token,
      expires_in: 3599,
      token_type: "Bearer",
      scope: "openid email profile",
    });

    const [h = "", p = "", s = ""] = String(body["id_token"]).split(".");
    const header = JSON.parse(b64url(h).toString("utf8")) as Record<string, unknown>;
    const claims = JSON.parse(b64url(p).toString("utf8")) as Record<string, unknown>;
    expect(header).toEqual({ alg: "RS256", kid: "fake-signin-1", typ: "JWT" });

    const jwks = JSON.parse(
      (await google("www.googleapis.com", "GET", "/oauth2/v3/certs")).body,
    ) as { keys: JsonWebKey[] };
    const key = createPublicKey({ key: jwks.keys[0] ?? {}, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), key, b64url(s))).toBe(true);

    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "azp", "email", "email_verified", "exp", "iat", "iss", "name", "nonce", "sub"].sort(),
    );
    expect(claims).toMatchObject({
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      azp: CLIENT_ID,
      sub: "canary-sub-7f3a",
      email: CANARIES.email,
      email_verified: true,
      name: "Canary User",
      nonce: "n-1",
    });
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBe(3600);
    expect(Math.abs(Number(claims["iat"]) - Date.now() / 1000)).toBeLessThan(60);
  });

  it.each([["signin."], ["gmail-code"], ["signin.***"]])(
    "TP-16.2: code %s → 400 invalid_grant",
    async (code) => {
      const r = await signInToken(code);

      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: "invalid_grant" });
    },
  );

  it("TP-16.2: with control mode invalid_grant set, sign-in still answers 200", async () => {
    await control("invalid_grant");
    const r = await signInToken(m.fakeSignInCode("n-2"));
    await control("ok");

    expect(r.status).toBe(200);
  });
});

describe("TP-16.2: JWKS", () => {
  it("TP-16.2: one public key with kid, alg RS256, use sig, and no private members", async () => {
    const r = await google("www.googleapis.com", "GET", "/oauth2/v3/certs");
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toMatch(/^application\/json/);
    const { keys } = JSON.parse(r.body) as { keys: Record<string, unknown>[] };

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      kty: "RSA",
      kid: "fake-signin-1",
      alg: "RS256",
      use: "sig",
      n: publicJwk.n,
      e: publicJwk.e,
    });
    for (const member of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect(keys[0]).not.toHaveProperty(member);
    }
  });

  it("TP-16.2: another path → 404", async () => {
    expect((await google("www.googleapis.com", "GET", "/nope")).status).toBe(404);
  });
});
