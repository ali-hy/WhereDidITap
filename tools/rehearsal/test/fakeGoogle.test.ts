// F-196 fake Google (A-24): Gmail control modes, the sign-in token branch, its RS256 id_token and
// the JWKS. TP-16.2. The fake is an HTTPS server answering by Host; its certificate here is a
// throwaway self-signed one with the four Google names as SANs.
import { execFileSync } from "node:child_process";
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANARIES } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFakeGoogle, type FakeGoogleModule } from "./support/load.js";

const CLIENT_ID = "rehearsal-signin.apps.googleusercontent.com";
const HOSTS = [
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "gmail.googleapis.com",
  "pubsub.googleapis.com",
];

let m: FakeGoogleModule;
let fake: { close(): Promise<void> } | undefined;
let port = 0;
let controlPort = 0;
let cert: Buffer;
let dir = "";
let publicJwk: JsonWebKey;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => {
        resolve(p);
      });
    });
  });
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function google(host: string, method: string, urlPath: string, form?: Record<string, string>) {
  const body = form === undefined ? undefined : new URLSearchParams(form).toString();
  return new Promise<Reply>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        servername: host,
        ca: cert,
        headers: {
          Host: host,
          ...(body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function control(mode: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: controlPort,
        method: "POST",
        path: "/__control",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          resolve(res.statusCode ?? 0);
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ mode }));
  });
}

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

beforeAll(async () => {
  m = await loadFakeGoogle();
  dir = mkdtempSync(path.join(tmpdir(), "budmon-fake-google-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=oauth2.googleapis.com",
      "-addext",
      `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(",")}`,
      "-keyout",
      path.join(dir, "key.pem"),
      "-out",
      path.join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  cert = readFileSync(path.join(dir, "cert.pem"));
  const keyPair = m.generateSignInKeyPair();
  publicJwk = keyPair.publicKey.export({ format: "jwk" });
  port = await freePort();
  controlPort = await freePort();
  fake = await m.startFakeGoogle({
    tls: { key: readFileSync(path.join(dir, "key.pem")), cert },
    port,
    controlPort,
    canaries: CANARIES,
    signInClientId: CLIENT_ID,
    signInKeyPair: keyPair,
  });
}, 60_000);

afterAll(async () => {
  await fake?.close();
  rmSync(dir, { recursive: true, force: true });
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

describe("TP-16.2: Gmail token branch under each control mode", () => {
  it("TP-16.2: ok → 200 with the canary tokens", async () => {
    expect(await control("ok")).toBe(200);
    const r = await gmailToken();

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      access_token: CANARIES.token,
      refresh_token: `${CANARIES.token}-r`,
      expires_in: 3599,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      token_type: "Bearer",
    });
  });

  it("TP-16.2: invalid_grant → 400 with canaries.message as error_description", async () => {
    expect(await control("invalid_grant")).toBe(200);
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({
      error: "invalid_grant",
      error_description: CANARIES.message,
    });
  });

  it("TP-16.2: server_error → 500 whose body contains canaries.token", async () => {
    expect(await control("server_error")).toBe(200);
    const r = await gmailToken();
    await control("ok");

    expect(r.status).toBe(500);
    expect(r.body).toContain(CANARIES.token);
  });

  it("TP-16.2: gaxios_error → a malformed body", async () => {
    expect(await control("gaxios_error")).toBe(200);
    const r = await gmailToken();
    await control("ok");

    expect(() => JSON.parse(r.body) as unknown).toThrow();
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
    ) as {
      keys: JsonWebKey[];
    };
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
    expect(await control("invalid_grant")).toBe(200);
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

  it("TP-16.2: another host or path → 404", async () => {
    expect((await google("www.googleapis.com", "GET", "/nope")).status).toBe(404);
  });
});
