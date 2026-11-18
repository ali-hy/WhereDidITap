// Two-step under rotated keys (identity LLD §4.5, F-34's sealed columns, P-F-117). TP-4.14 (the
// recovery-code key ring) and TP-4.16 (re-wrapping TOTP envelopes with secrets:rewrap-api), plus
// extra cases ending in "x".
// The API is built with known rings: API_SECRETS_KEYS_FILE and RECOVERY_CODE_HMAC_KEYS_FILE are
// both { current: k2, keys: { k1, k2 } }.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { randomBytes } from "node:crypto";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiSecretsCipher } from "../../../src/platform/crypto/apiSecrets.js";
import { keyVersionOf } from "../../../src/platform/crypto/envelope.js";
import { rewrapApiSecretsCommand } from "../../../src/platform/crypto/rewrap.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import {
  FACTORY_PASSWORD,
  passwordFactory,
  pendingSecretFactory,
  recoveryCodesFactory,
  sessionFactory,
  userFactory,
} from "../../factories/identity.js";
import { devApi, withFile, type Fixture } from "../../support/configEnv.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { call } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";
import { codeAt } from "../../support/totp.js";
import {
  apiSecretsOf,
  bearer,
  recoveryCodeRows,
  recoveryRingOf,
  SECRET_BYTES,
  twoStepRow,
  twoStepUser,
} from "../../support/twoStep.js";

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const RING = JSON.stringify({
  current: "k2",
  keys: { k1: K1.toString("base64"), k2: K2.toString("base64") },
});
const fixture = (): Fixture => {
  const f = devApi();
  withFile(f, "API_SECRETS_KEYS_FILE", RING);
  withFile(f, "RECOVERY_CODE_HMAC_KEYS_FILE", RING);
  return f;
};

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);

beforeAll(async () => {
  api = await buildIdentityApi({ fixture });
  await api.container.boss.start();
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

async function challengeFor(email: string): Promise<string> {
  const res = await call(api.app, "POST", "/auth/sign-in", {
    email,
    password: FACTORY_PASSWORD,
    tokenDelivery: "body",
  });
  expect(res.json()).toMatchObject({ status: "two_step_required" });
  return (res.json() as { challengeToken: string }).challengeToken;
}

const verify = async (email: string, factor: { code: string } | { recoveryCode: string }) =>
  call(api.app, "POST", "/auth/two-step/verify", {
    challengeToken: await challengeFor(email),
    ...factor,
    tokenDelivery: "body",
  });

describe("TP-4.14: recovery codes under a rotated key ring", () => {
  it("TP-4.14: a code stored under k1, with the ring { current: k2, keys: k1, k2 } → accepted at sign-in", async () => {
    expect(recoveryRingOf(api).current).toBe("k2");
    const { user } = await twoStepUser(api, { now: NOW });
    const codes = await recoveryCodesFactory(h, recoveryRingOf(api), {
      userId: user.id,
      now: NOW,
      keyId: "k1",
    });
    expect((await recoveryCodeRows(h, user.id)).map((r) => r.keyId)).toEqual(
      Array.from({ length: 10 }, () => "k1"),
    );

    const res = await verify(user.email, { recoveryCode: codes[0] ?? "" });

    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: "signed_in", recoveryCodesLeft: 9 });
  });

  it("TP-4.14x: codes created by me.twoStepEnable are stored under the current key k2", async () => {
    const user = await userFactory(h);
    await passwordFactory(h, user.id);
    await pendingSecretFactory(h, apiSecretsOf(api), {
      userId: user.id,
      expiresAt: NOW.add({ minutes: 15 }),
    });
    const session = await sessionFactory(h, { userId: user.id, now: NOW });

    const res = await call(
      api.app,
      "POST",
      "/me/two-step/enable",
      { code: codeAt(SECRET_BYTES, NOW) },
      { headers: bearer(session.accessToken) },
    );

    expect(res.status).toBe(200);
    expect((await recoveryCodeRows(h, user.id)).map((r) => r.keyId)).toEqual(
      Array.from({ length: 10 }, () => "k2"),
    );
  });
});

describe("TP-4.16: secrets:rewrap-api re-wraps the TOTP envelopes (P-4)", () => {
  it("TP-4.16: an enabled secret and a pending replacement sealed under k1 → rewrapApiSecretsCommand re-wraps 2; both carry k2; the sign-in code and the replacement's code are then accepted", async () => {
    const k1Only = createApiSecretsCipher({ current: "k1", keys: new Map([["k1", K1]]) });
    const replacement = Buffer.from("abcdefghijabcdefghij", "utf8");
    const { user } = await twoStepUser(api, { now: NOW, cipher: k1Only });
    await pendingSecretFactory(h, k1Only, {
      userId: user.id,
      expiresAt: NOW.add({ minutes: 15 }),
      secret: replacement,
    });
    const before = await twoStepRow(h, user.id);
    expect(keyVersionOf(before?.secretEnvelope ?? Buffer.alloc(0))).toBe("k1");
    expect(keyVersionOf(before?.pendingSecretEnvelope ?? Buffer.alloc(0))).toBe("k1");

    const result = await rewrapApiSecretsCommand(api.container);

    expect(result).toMatchObject({ rewrapped: 2 });
    const after = await twoStepRow(h, user.id);
    expect(keyVersionOf(after?.secretEnvelope ?? Buffer.alloc(0))).toBe("k2");
    expect(keyVersionOf(after?.pendingSecretEnvelope ?? Buffer.alloc(0))).toBe("k2");

    const signedIn = await verify(user.email, { code: codeAt(SECRET_BYTES, NOW) });
    expect(signedIn.status).toBe(200);
    expect(signedIn.json()).toMatchObject({ status: "signed_in" });

    const session = await sessionFactory(h, { userId: user.id, now: NOW });
    const replaced = await call(
      api.app,
      "POST",
      "/me/two-step/replace/confirm",
      { code: codeAt(replacement, NOW, 1) },
      { headers: bearer(session.accessToken) },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.json()).toEqual({ ok: true });
  });
});
