// F-41 accepting a bootstrap invitation (identity LLD §4.2, §4.3, S-2) through the real HTTP layer.
// TP-2.3, TP-2.4. The invitations are inserted by the factory, so these run without F-45.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { invitationFactory, userFactory } from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { call, errorOf } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);
const OWNER_EMAIL = "owner@x.com";

beforeAll(async () => {
  api = await buildIdentityApi();
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const accept = (token: string) =>
  call(
    api.app,
    "POST",
    "/invitations/accept",
    {
      token,
      displayName: "Dev Owner",
      locale: "en",
      timeZone: "Africa/Cairo",
      baseCurrency: "USD",
      method: { kind: "password", password: "violet staircase umbrella" },
      tokenDelivery: "body",
    },
    { client: "android/1" },
  );

async function bootstrapInvitation(email: string): Promise<string> {
  const { token } = await invitationFactory(h, {
    email,
    origin: "bootstrap",
    now: NOW,
    withToken: true,
  });
  if (token === null) throw new Error("no token");
  return token;
}

const userByEmail = async (email: string) =>
  (await h.executeSql("SELECT * FROM users WHERE email = $1", [email])).rows[0];

describe("TP-2.3: accepting the bootstrap invitation makes the owner", () => {
  it("TP-2.3: accept → is_product_owner = true, invite_allowance = null", async () => {
    const token = await bootstrapInvitation(OWNER_EMAIL);

    const res = await accept(token);

    expect(res.status).toBe(200);
    expect(await userByEmail(OWNER_EMAIL)).toMatchObject({
      is_product_owner: true,
      invite_allowance: null,
    });
  });
});

describe("TP-2.4: a second owner through a forged second bootstrap invitation", () => {
  it("TP-2.4: an owner exists; accepting a second bootstrap invitation inserted by the repo → INVITATION_REVOKED, no user created", async () => {
    await userFactory(h, { isProductOwner: true, inviteAllowance: null });
    const token = await bootstrapInvitation("second-owner@x.com");
    const before = (await h.executeSql("SELECT count(*)::int AS n FROM users")).rows[0]?.["n"];

    const res = await accept(token);

    expect(res.status).toBe(410);
    expect(errorOf(res).code).toBe("INVITATION_REVOKED");
    expect(await userByEmail("second-owner@x.com")).toBeUndefined();
    expect((await h.executeSql("SELECT count(*)::int AS n FROM users")).rows[0]?.["n"]).toBe(
      before,
    );
  });
});
