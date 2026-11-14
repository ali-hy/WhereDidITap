// The API server with a test contract and router (S-4 AC 1). TP-4.10 (F-52's interceptor),
// TP-4.11's integration part (F-56's middleware), TP-4.19 (body handling, F-55 step 5 with F-62)
// TP-4.25 (query coercion, A-148; bodies never coerced, A-165; no method, no coercion, A-171;
// HEAD unsupported, A-175),
// TP-4.26 (defined errors, A-149; declared message, A-166) and TP-5.2 to TP-5.4 (F-62,
// moved to S-4, A-124; A-152), plus extra cases TP-4.41x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { request, type IncomingHttpHeaders } from "node:http";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import {
  buildApiContainer,
  injectJson,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";
import { testContract, testRouter, type TestRouter } from "../../support/testRouter.js";

let built: BuiltContainer;
let app: FastifyInstance;
let obs: Observed;
let routes: TestRouter;

beforeAll(async () => {
  obs = observed();
  built = await buildApiContainer(obs.overrides, {
    CLIENT_MIN_ANDROID: "5",
    CLIENT_LATEST_ANDROID: "5",
    CLIENT_MIN_WEB: "2",
  });
  routes = testRouter(new Error(CANARIES.message));
  app = await createApiServer(built.container, {
    contract: testContract,
    router: routes.router as never,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await built.close();
});

beforeEach(() => {
  routes.createHandler.mockClear();
});

const IDEMPOTENCY = { "idempotency-key": "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0e" };

describe("TP-4.10: the error interceptor through HTTP", () => {
  it("TP-4.10: RateLimitedError(30) is 429 with Retry-After: 30 and no report", async () => {
    const reportsBefore = obs.reporter.events.length;

    const res = await injectJson(app, "GET", "/api/v1/test/rate-limited");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.json()).toEqual({
      defined: true,
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests",
      data: { retryAfterSeconds: 30 },
    });
    expect(obs.reporter.events.length).toBe(reportsBefore);
  });

  it("TP-4.10: an Error carrying a canary is the exact INTERNAL envelope, one report without the canary, one request_failed line", async () => {
    const reportsBefore = obs.reporter.events.length;
    const linesBefore = obs.capture.records().length;

    const res = await injectJson(app, "GET", "/api/v1/test/boom");

    expect(res.status).toBe(500);
    expect(res.json()).toEqual({
      defined: true,
      code: "INTERNAL",
      status: 500,
      message: "Internal error",
      data: { outcome: "not_applied" },
    });
    expect(obs.reporter.events.length).toBe(reportsBefore + 1);
    const failed = obs.capture
      .records()
      .slice(linesBefore)
      .filter((l) => l["event"] === "request_failed");
    expect(failed).toHaveLength(1);
    expect(
      scanForCanaries(
        [
          { name: "reports", text: JSON.stringify(obs.reporter.events) },
          { name: "logs", text: obs.capture.text() },
          { name: "body", text: res.body },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });
});

describe("TP-4.11: the client version check through HTTP", () => {
  it.each([
    ["android/4", 400, { minimumVersion: 5 }],
    ["android/5", 200, undefined],
    ["web/1", 400, { minimumVersion: 2 }],
    ["ios/1", 200, undefined],
  ] as const)("TP-4.11: X-Budmon-Client %s on test.ping gives %i", async (header, status, data) => {
    const res = await injectJson(app, "GET", "/api/v1/test/ping", undefined, {
      "x-budmon-client": header,
    });

    expect(res.status).toBe(status);
    if (data !== undefined) {
      expect(res.json()).toEqual({
        defined: true,
        code: "CLIENT_UPDATE_REQUIRED",
        status: 400,
        message: "Client update required",
        data,
      });
    }
  });

  it("TP-4.11: no X-Budmon-Client header passes", async () => {
    expect((await injectJson(app, "GET", "/api/v1/test/ping")).status).toBe(200);
  });

  it("TP-4.11: android/1 on meta.clientConfig passes (exempt)", async () => {
    const res = await injectJson(app, "GET", "/api/v1/meta/client-config", undefined, {
      "x-budmon-client": "android/1",
    });

    expect(res.status).toBe(200);
  });

  it("TP-4.41x: a blocked request increments client_update_required_total", async () => {
    await injectJson(app, "GET", "/api/v1/test/ping", undefined, {
      "x-budmon-client": "android/2",
    });

    const metric = (await obs.collect()).get("client_update_required_total");
    const android = metric?.dataPoints.find((p) => p.attributes["client_kind"] === "android");
    expect(android?.value).toBeGreaterThanOrEqual(1);
  });
});

describe("TP-4.19: body handling, Fastify's parser before oRPC", () => {
  it("TP-4.19: valid JSON creates: 201", async () => {
    const res = await injectJson(app, "POST", "/api/v1/test/things", { name: "x" }, IDEMPOTENCY);

    expect(res.status).toBe(201);
    expect(routes.createHandler).toHaveBeenCalledTimes(1);
  });

  it("TP-4.19: malformed JSON is F-62's 400 invalid_json and the handler never runs", async () => {
    const res = await injectJson(app, "POST", "/api/v1/test/things", '{"name": "x"', IDEMPOTENCY);

    expect(res.status).toBe(400);
    expect(res.json()).toEqual({
      defined: true,
      code: "VALIDATION_FAILED",
      status: 400,
      message: "Validation failed",
      data: {
        issues: [{ path: [], code: "invalid_json", message: "Request body is not valid JSON." }],
      },
    });
    expect(routes.createHandler).not.toHaveBeenCalled();
  });

  it("TP-4.19: a body of 100 KiB + 1 is 413 and the handler never runs", async () => {
    const name = "x".repeat(102_401 - '{"name":""}'.length);

    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      `{"name":"${name}"}`,
      IDEMPOTENCY,
    );

    expect(res.status).toBe(413);
    expect(res.json()).toMatchObject({ defined: true, code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(routes.createHandler).not.toHaveBeenCalled();
  });

  it("TP-4.19: an unknown field is oRPC's 400 VALIDATION_FAILED with code unrecognized_keys", async () => {
    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      { name: "x", extra: 1 },
      IDEMPOTENCY,
    );

    expect(res.status).toBe(400);
    const body = res.json() as { code: string; data: { issues: { code: string }[] } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.data.issues.map((i) => i.code)).toContain("unrecognized_keys");
    expect(routes.createHandler).not.toHaveBeenCalled();
  });
});

describe("TP-5.2 to TP-5.4: body handling (F-62)", () => {
  it("TP-5.2: invalid JSON carrying a canary is 400 invalid_json; no canary in the response or the logs", async () => {
    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      `{"a":"${CANARIES.token}`,
      IDEMPOTENCY,
    );

    expect(res.status).toBe(400);
    expect(res.json()).toEqual({
      defined: true,
      code: "VALIDATION_FAILED",
      status: 400,
      message: "Validation failed",
      data: {
        issues: [{ path: [], code: "invalid_json", message: "Request body is not valid JSON." }],
      },
    });
    expect(
      scanForCanaries(
        [
          { name: "body", text: res.body },
          { name: "logs", text: obs.capture.text() },
          { name: "reports", text: JSON.stringify(obs.reporter.events) },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });

  it("TP-5.3: a body of 100 KiB + 1 is 413 PAYLOAD_TOO_LARGE", async () => {
    const name = "y".repeat(102_401 - '{"name":""}'.length);

    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/things",
      `{"name":"${name}"}`,
      IDEMPOTENCY,
    );

    expect(res.status).toBe(413);
    expect(res.json()).toEqual({
      defined: true,
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      message: "Payload too large",
    });
  });

  it("TP-5.4: Content-Type text/plain is 400 with issue code unsupported_media_type", async () => {
    const res = await injectJson(app, "POST", "/api/v1/test/things", "name=x", {
      ...IDEMPOTENCY,
      "content-type": "text/plain",
    });

    expect(res.status).toBe(400);
    const body = res.json() as { code: string; data: { issues: { code: string }[] } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.data.issues.map((i) => i.code)).toEqual(["unsupported_media_type"]);
    expect(routes.createHandler).not.toHaveBeenCalled();
  });
});

describe("TP-5.2: prototype keys are removed before validation (A-152)", () => {
  it("TP-5.2: __proto__ and constructor.prototype are stripped; the handler gets { a: 1 } only", async () => {
    routes.looseInputs.length = 0;

    const res = await injectJson(
      app,
      "POST",
      "/api/v1/test/loose",
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"p":1}},"a":1}',
      IDEMPOTENCY,
    );

    expect(res.status).toBe(201);
    expect(routes.looseInputs).toEqual([{ a: 1 }]);
    expect(Object.keys(routes.looseInputs[0] as object)).toEqual(["a"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["p"]).toBeUndefined();
  });
});

describe("TP-4.25: query strings are coerced to the declared types (A-148)", () => {
  it("TP-4.25: ?limit=5&active=true reaches the handler as the number 5 and true", async () => {
    routes.listInputs.length = 0;

    const res = await injectJson(app, "GET", "/api/v1/t/list?limit=5&active=true");

    expect(res.status).toBe(200);
    expect(routes.listInputs).toHaveLength(1);
    expect(routes.listInputs[0]).toMatchObject({ limit: 5, active: true });
  });

  it.each([["limit=abc"], ["limit=0"], ["active=yes"]])(
    "TP-4.25: ?%s is VALIDATION_FAILED",
    async (query) => {
      const res = await injectJson(app, "GET", `/api/v1/t/list?${query}`);

      expect(res.status).toBe(400);
      expect((res.json() as { code: string }).code).toBe("VALIDATION_FAILED");
    },
  );

  it("TP-4.25: the emitted parameters are type integer (limit) and type boolean (active)", async () => {
    const { OpenAPIGenerator } = await import("@orpc/openapi");
    const { ZodToJsonSchemaConverter } = await import("@orpc/zod/zod4");
    const doc: unknown = await new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }).generate({ list: testContract.test.list }, { info: { title: "t", version: "1.0" } });
    const parameters =
      (
        doc as {
          paths: Record<string, { get: { parameters: { name: string; schema: unknown }[] } }>;
        }
      ).paths["/t/list"]?.get.parameters ?? [];
    const schemaOf = (name: string) => parameters.find((p) => p.name === name)?.schema;

    expect(schemaOf("limit")).toMatchObject({ type: "integer" });
    expect(schemaOf("active")).toMatchObject({ type: "boolean" });
  });
});

describe("TP-4.25: request bodies are never coerced (A-165)", () => {
  const post = (body: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/v1/t/create",
      headers: { "content-type": "application/json", ...IDEMPOTENCY },
      payload: JSON.stringify(body),
    });

  it("TP-4.25: a body with real numbers and booleans is accepted (control)", async () => {
    routes.typedInputs.length = 0;

    const res = await post({ limit: 5, amountMinor: 100, flag: true });

    expect(res.statusCode).toBe(201);
    expect(routes.typedInputs).toEqual([{ limit: 5, amountMinor: 100, flag: true }]);
  });

  it.each([
    ["{limit: '5'}", { limit: "5" }],
    ["{amountMinor: ' 100 ', flag: 'ON'}", { amountMinor: " 100 ", flag: "ON" }],
    ["{amountMinor: ' 100 '}", { amountMinor: " 100 " }],
    ["{flag: 'ON'}", { flag: "ON" }],
  ])("TP-4.25: body %s is VALIDATION_FAILED, the handler not called", async (_l, body) => {
    routes.typedInputs.length = 0;

    const res = await post(body);

    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe("VALIDATION_FAILED");
    expect(routes.typedInputs).toEqual([]);
  });
});

describe("TP-4.25: HEAD isn't supported on /api/v1 (A-175)", () => {
  // Over a real socket: Node's HTTP server drops a HEAD response's body (inject doesn't).
  it("TP-4.25: HEAD /t/list?limit=5 is 404 with no body and the version header; the handler isn't called", async () => {
    routes.listInputs.length = 0;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const res = await new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = request(`${address}/api/v1/t/list?limit=5`, { method: "HEAD" }, (r) => {
          let body = "";
          r.setEncoding("utf8");
          r.on("data", (chunk: string) => (body += chunk));
          r.on("end", () => {
            resolve({ status: r.statusCode ?? 0, headers: r.headers, body });
          });
        });
        req.on("error", reject);
        req.end();
      },
    );

    expect(res.status).toBe(404);
    expect(res.body).toBe("");
    expect(res.headers["x-budmon-api-version"]).toMatch(/^1\.\d+$/);
    expect(routes.listInputs).toEqual([]);
  });
});

describe("TP-4.25: a context without method gets no coercion (A-171)", () => {
  let bare: FastifyInstance;

  beforeAll(async () => {
    bare = await createApiServer(built.container, {
      contract: testContract,
      router: routes.router as never,
    });
    // Runs after F-55's onRequest hook (registered first): the context loses its method.
    bare.addHook("onRequest", (request, _reply, done) => {
      if (request.budmon !== null) delete (request.budmon as { method?: string }).method;
      done();
    });
    await bare.ready();
  });

  afterAll(async () => {
    await bare.close();
  });

  it("TP-4.25: GET ?limit=5 is VALIDATION_FAILED without method, and the handler is not called", async () => {
    routes.listInputs.length = 0;

    const res = await injectJson(bare, "GET", "/api/v1/t/list?limit=5");

    expect(res.status).toBe(400);
    expect((res.json() as { code: string }).code).toBe("VALIDATION_FAILED");
    expect(routes.listInputs).toEqual([]);
  });
});

describe("TP-4.26: contract-defined errors pass through (A-149)", () => {
  it("TP-4.26: errors.CONFLICT({ data: { reason: 'taken' } }) is the 409 envelope with its data, not reported", async () => {
    const reportsBefore = obs.reporter.events.length;

    const res = await injectJson(app, "GET", "/api/v1/test/conflict");

    expect(res.status).toBe(409);
    expect(res.json()).toMatchObject({
      defined: true,
      code: "CONFLICT",
      status: 409,
      data: { reason: "taken" },
    });
    expect(obs.reporter.events.length).toBe(reportsBefore);
  });

  it("TP-4.26: (A-166) a custom thrown message is replaced by the declared one; the data is kept", async () => {
    const reportsBefore = obs.reporter.events.length;

    const res = await injectJson(app, "GET", "/api/v1/test/conflict-custom");

    expect(res.status).toBe(409);
    expect(res.json()).toEqual({
      defined: true,
      code: "CONFLICT",
      status: 409,
      message: "Conflict",
      data: { reason: "taken" },
    });
    expect(scanForCanaries([{ name: "body", text: res.body }], CANARIES)).toEqual([]);
    expect(obs.reporter.events.length).toBe(reportsBefore);
  });
});
