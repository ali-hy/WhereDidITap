// F-65 rateLimited middleware and the coarse per-IP limit, and the trusted proxy (S-5). TP-5.6,
// TP-5.7 and TP-5.10, plus extra cases TP-5.13x. IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs.
import { base, contract } from "@budmon/contract";
import { implement } from "@orpc/server";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RequestContext } from "../../../src/platform/http/context.js";
import { metaRouter } from "../../../src/platform/http/meta.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { rateLimited } from "../../../src/platform/security/rateLimiter.js";
import {
  buildApiContainer,
  injectJson,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";

const Ok = z.object({ ok: z.boolean() });

const limitContract = {
  ...contract,
  test: {
    limited: base.route({ method: "GET", path: "/test/limited" }).output(Ok),
  },
};

const ipContract = {
  ...contract,
  test: {
    ip: base.route({ method: "GET", path: "/test/ip" }).output(z.object({ ip: z.string() })),
  },
};

/** TP-5.10's procedure: echoes ctx.ip. */
function ipRouter(): Record<string, unknown> {
  const os = implement(ipContract).$context<RequestContext>();
  return {
    meta: metaRouter,
    test: { ip: os.test.ip.handler(({ context }) => ({ ip: context.ip })) },
  };
}

/** TP-5.6's procedure behind rateLimited. */
function limitRouter(): Record<string, unknown> {
  const os = implement(limitContract).$context<RequestContext>();
  return {
    meta: metaRouter,
    test: {
      limited: os.test.limited
        .use(
          rateLimited({
            spec: { limiter: "test", limit: 1, windowSeconds: 600 },
            subject: (_input, ctx) => ctx.ip,
          }),
        )
        .handler(() => ({ ok: true })),
    },
  };
}

const RATE_LIMITED_ENVELOPE = {
  defined: true,
  code: "RATE_LIMITED",
  status: 429,
  message: "Too many requests",
};

describe("TP-5.6: a rate-limited procedure (F-65)", () => {
  let built: BuiltContainer | undefined;
  let app: FastifyInstance | undefined;
  let obs: Observed;

  beforeAll(async () => {
    obs = observed();
    const router = limitRouter();
    built = await buildApiContainer(obs.overrides);
    app = await createApiServer(built.container, {
      contract: limitContract,
      router: router as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await built?.close();
  });

  it("TP-5.6: the second call is 429 RATE_LIMITED with retryAfterSeconds ≥ 1 and Retry-After; rate_limited_total{limiter=test} = 1", async () => {
    if (app === undefined) throw new Error("the API didn't start");
    const first = await injectJson(app, "GET", "/api/v1/test/limited");
    const second = await injectJson(app, "GET", "/api/v1/test/limited");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    const body = second.json() as { data?: { retryAfterSeconds?: unknown } };
    expect(body).toMatchObject(RATE_LIMITED_ENVELOPE);
    expect(typeof body.data?.retryAfterSeconds).toBe("number");
    expect(Number(body.data?.retryAfterSeconds)).toBeGreaterThanOrEqual(1);
    expect(Number(second.headers["retry-after"])).toBe(body.data?.retryAfterSeconds);
    const metric = (await obs.collect()).get("rate_limited_total");
    const point = metric?.dataPoints.find((p) => p.attributes["limiter"] === "test");
    expect(point?.value).toBe(1);
  });
});

describe("TP-5.7: the coarse per-IP limit (F-65)", () => {
  let built: BuiltContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    built = await buildApiContainer();
    app = await createApiServer(built.container);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await built.close();
  });

  it("TP-5.7: 301 × GET /api/v1/meta/client-config from one IP: 300 are 200, the 301st is the 429 envelope with Retry-After; 301 × /health/live never 429", async () => {
    const statuses: number[] = [];
    let first: Awaited<ReturnType<typeof injectJson>> | undefined;
    let last: Awaited<ReturnType<typeof injectJson>> | undefined;
    for (let i = 0; i < 301; i++) {
      last = await injectJson(app, "GET", "/api/v1/meta/client-config");
      first ??= last;
      statuses.push(last.status);
    }

    expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
    expect(last?.status).toBe(429);
    const body = last?.json() as { data?: { retryAfterSeconds?: unknown } };
    expect(body).toMatchObject(RATE_LIMITED_ENVELOPE);
    expect(Number(body.data?.retryAfterSeconds)).toBeGreaterThanOrEqual(1);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    // A-195: the plugin's limiter-state headers are off, on the 429 and on a 200.
    const rateLimitHeaders = (headers: Record<string, unknown> | undefined) =>
      Object.keys(headers ?? {}).filter((name) => name.toLowerCase().startsWith("x-ratelimit"));
    expect(first?.status).toBe(200);
    expect(rateLimitHeaders(first?.headers)).toEqual([]);
    expect(rateLimitHeaders(last?.headers)).toEqual([]);

    const health: number[] = [];
    for (let i = 0; i < 301; i++) {
      health.push((await injectJson(app, "GET", "/health/live")).status);
    }
    expect(health.filter((s) => s !== 200)).toEqual([]);
  });

  it("TP-5.13x: another IP isn't limited by the first one's count", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/meta/client-config",
      remoteAddress: "10.0.0.7",
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("TP-5.10: only the configured proxy's X-Forwarded-For is trusted", () => {
  let built: BuiltContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    built = await buildApiContainer({}, { TRUSTED_PROXY: "10.0.0.2" });
    app = await createApiServer(built.container, {
      contract: ipContract,
      router: ipRouter() as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await built.close();
  });

  // The procedure echoes ctx.ip in its response (the request log carries no ip field).
  it.each([
    ["10.0.0.9 (not the proxy): the header is ignored", "10.0.0.9", "10.0.0.9"],
    ["10.0.0.2 (the proxy): the forwarded address is used", "10.0.0.2", "1.2.3.4"],
  ])("TP-5.10: from %s", async (_label, remoteAddress, expected) => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/test/ip",
      remoteAddress,
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ ip: string }>().ip).toBe(expected);
  });
});
