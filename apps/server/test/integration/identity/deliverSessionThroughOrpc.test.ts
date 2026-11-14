// TP-0.33: F-27 deliverSession through oRPC (P-F-55). A public test procedure built from
// procedureBases (P-A-123) delivers a cookie session with a device token; the reply carries 4
// separate set-cookie headers equal to TP-0.14's values. TP-0.33x (setCookieThroughOrpc.test.ts)
// checks the same plugin behaviour without identity's code.
import { base, contract } from "@budmon/contract";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { metaRouter } from "../../../src/platform/http/meta.js";
import { procedureBases } from "../../../src/platform/http/procedures.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { deliverSession } from "../../../src/identity/deliver.js";
import { injectJson } from "../../support/api.js";
import { buildIdentityApi, setCookies, T0, type IdentityApi } from "../../support/identity.js";

const NOW = Temporal.Instant.from(T0);
const ACCESS = `bma_${"A".repeat(43)}`;
const REFRESH = `bmr_${"R".repeat(43)}`;
const DEVICE = `bmd_${"D".repeat(43)}`;
const ATTRS = "HttpOnly; Secure; SameSite=Strict";

const sessionContract = {
  ...contract,
  test: {
    deliver: base
      .route({ method: "POST", path: "/test/deliver" })
      .input(z.object({}))
      .output(z.object({ tokens: z.unknown() })),
  },
};

let api: IdentityApi;
let close: () => Promise<void>;
let app: Awaited<ReturnType<typeof createApiServer>>;

beforeAll(async () => {
  api = await buildIdentityApi();
  const { publicProcedure } = procedureBases(sessionContract);
  const router = {
    meta: metaRouter,
    test: {
      deliver: publicProcedure.test.deliver.handler(({ context }) => ({
        tokens: deliverSession(context, {
          sessionId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a70",
          userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a71",
          accessToken: ACCESS,
          refreshToken: REFRESH,
          accessExpiresAt: NOW.add({ minutes: 15 }),
          refreshExpiresAt: NOW.add({ hours: 24 * 30 }),
          delivery: "cookie",
          deviceToken: DEVICE,
        }),
      })),
    },
  };
  app = await createApiServer(api.container, {
    contract: sessionContract,
    router: router as never,
  });
  close = async () => {
    await app.close();
    await api.close();
  };
});

afterAll(async () => {
  await close();
});

describe("TP-0.33: cookies through oRPC", () => {
  it("TP-0.33: 4 separate set-cookie headers equal to TP-0.14's values; tokens null in the body", async () => {
    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/deliver",
      {},
      {
        host: "x.ts.net",
        "x-budmon-client": "web/1",
      },
    );

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ tokens: null });
    expect(setCookies(res).sort()).toEqual(
      [
        `__Secure-budmon_at=${ACCESS}; Path=/api/v1; Max-Age=900; ${ATTRS}`,
        `__Secure-budmon_rt=${REFRESH}; Path=/api/v1/auth/refresh; Max-Age=2592000; ${ATTRS}`,
        `__Secure-budmon_dv=${DEVICE}; Path=/api/v1; Max-Age=31536000; ${ATTRS}`,
        `__Secure-budmon_2fa=; Path=/api/v1/auth; Max-Age=0; ${ATTRS}`,
      ].sort(),
    );
  });
});
