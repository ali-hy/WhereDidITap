// F-102 runIdempotentCreate through HTTP. TP-7.7 and TP-7.15, plus extra cases TP-7.18x. IDs
// ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// A test create procedure (createRoute, F-343) inserts into a test table through
// runIdempotentCreate; the principal comes from an auth hook that always signs the test user in.
import { base, contract, createRoute } from "@budmon/contract";
import { implement } from "@orpc/server";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Principal, RequestContext } from "../../../src/platform/http/context.js";
import { metaRouter } from "../../../src/platform/http/meta.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { createTestUser } from "@budmon/test-support";
import {
  buildApiContainer,
  injectJson,
  testPrincipal,
  type BuiltContainer,
} from "../../support/api.js";
import { query } from "../../support/postgres.js";
import {
  requestHashOf,
  runIdempotentCreate,
} from "../../../src/platform/idempotency/idempotency.js";

const idemContract = {
  ...contract,
  test: {
    createIdem: createRoute("/test/idem-things").input(
      z.strictObject({ name: z.string().max(50) }),
    ),
    ping: base.route({ method: "GET", path: "/test/ping" }).output(z.object({ ok: z.boolean() })),
  },
};

function idemRouter(): Record<string, unknown> {
  const os = implement(idemContract).$context<RequestContext>();
  return {
    meta: metaRouter,
    test: {
      createIdem: os.test.createIdem.handler(({ input, context }) =>
        runIdempotentCreate(
          context as RequestContext & { principal: Principal },
          "test.createIdem",
          input,
          async (tx) => {
            const id = context.container.ids.next();
            const createdAt = context.container.clock.now();
            await tx.executeSql(
              "INSERT INTO test_idem_things (id, name, created_at) VALUES ($1, $2, $3)",
              [id, input.name, createdAt.toString()],
            );
            return { id, createdAt };
          },
        ),
      ),
      ping: os.test.ping.handler(() => ({ ok: true })),
    },
  };
}

let built: BuiltContainer | undefined;
let app: FastifyInstance | undefined;

// A-234: the signed-in user's id comes from createTestUser, once the test database exists.
let userId = "";

beforeAll(async () => {
  const router = idemRouter();
  const b = await buildApiContainer({
    authHook: { authenticate: () => Promise.resolve(testPrincipal({ userId })) },
  });
  built = b;
  userId = await createTestUser(b.testDb);
  await query(
    b.testDb.urlAs("budmon_migrator"),
    "CREATE TABLE test_idem_things (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL)",
  );
  await query(
    b.testDb.urlAs("budmon_migrator"),
    "GRANT SELECT, INSERT ON test_idem_things TO budmon_app",
  );
  app = await createApiServer(b.container, { contract: idemContract, router: router as never });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await built?.close();
});

function server(): FastifyInstance {
  if (app === undefined) throw new Error("the API didn't start");
  return app;
}

const KEY_1 = "0190a0b0-1c2d-7e3f-8a4b-0000000000c1";
const KEY_2 = "0190a0b0-1c2d-7e3f-8a4b-0000000000c2";

function post(key: string | undefined, body: unknown) {
  return injectJson(
    server(),
    "POST",
    "/api/v1/test/idem-things",
    body,
    key === undefined ? {} : { "idempotency-key": key },
  );
}

async function rows(): Promise<number> {
  const [row] = await query<{ n: number }>(
    built?.testDb.urlAs("budmon_migrator") ?? "",
    "SELECT count(*)::int AS n FROM test_idem_things",
  );
  return row?.n ?? -1;
}

describe("TP-7.7: the Idempotency-Key header (F-102)", () => {
  it.each([
    ["missing", undefined],
    ["not-a-uuid", "not-a-uuid"],
    ["an upper-case UUID", "0190A0B0-1C2D-7E3F-8A4B-0000000000C9"],
  ])(
    "TP-7.7: %s is 400 VALIDATION_FAILED at headers.idempotency-key, code invalid_idempotency_key",
    async (_label, key) => {
      const before = await rows();

      const res = await post(key, { name: "x" });

      expect(res.status).toBe(400);
      expect(res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        data: {
          issues: [
            {
              path: ["headers", "idempotency-key"],
              code: "invalid_idempotency_key",
              message: "Idempotency-Key must be a UUID",
            },
          ],
        },
      });
      expect(await rows()).toBe(before);
    },
  );
});

describe("TP-7.15: an idempotent create end to end (F-102)", () => {
  it("TP-7.15: POST twice with one key, then with a new key: 201 + body; 201 + the same body + Idempotent-Replayed: true; 201 + a new id; two rows", async () => {
    const before = await rows();

    const first = await post(KEY_1, { name: "one" });
    const replay = await post(KEY_1, { name: "one" });
    const other = await post(KEY_2, { name: "one" });

    expect(first.status).toBe(201);
    const body = first.json() as { id: string; createdAt: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();

    expect(replay.status).toBe(201);
    expect(replay.json()).toEqual(body);
    expect(replay.headers["idempotent-replayed"]).toBe("true");

    expect(other.status).toBe(201);
    expect((other.json() as { id: string }).id).not.toBe(body.id);
    expect(await rows()).toBe(before + 2);
  });
});

describe("TP-7.18x: idempotent creates, further cases (F-102)", () => {
  it("TP-7.18x: the same key with another body is 409 IDEMPOTENCY_KEY_REUSED and inserts nothing", async () => {
    const key = "0190a0b0-1c2d-7e3f-8a4b-0000000000c3";
    await post(key, { name: "first" });
    const before = await rows();

    const res = await post(key, { name: "second" });

    expect(res.status).toBe(409);
    expect(res.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await rows()).toBe(before);
  });

  it("TP-7.18x: the stored record belongs to the signed-in user", async () => {
    const key = "0190a0b0-1c2d-7e3f-8a4b-0000000000c4";
    await post(key, { name: "mine" });

    const [row] = await query<{ user_id: string }>(
      built?.testDb.urlAs("budmon_migrator") ?? "",
      "SELECT user_id::text AS user_id FROM idempotency_records WHERE idempotency_key = $1",
      [key],
    );

    expect(row?.user_id).toBe(userId);
  });

  it("TP-7.18x: (A-233, A-236) the stored request_hash is requestHashOf(the validated input)", async () => {
    const key = "0190a0b0-1c2d-7e3f-8a4b-0000000000c5";
    await post(key, { name: "hashed" });

    const [row] = await query<{ request_hash: Buffer }>(
      built?.testDb.urlAs("budmon_migrator") ?? "",
      "SELECT request_hash FROM idempotency_records WHERE idempotency_key = $1",
      [key],
    );

    expect(Buffer.from(row?.request_hash ?? [])).toEqual(requestHashOf({ name: "hashed" }));
  });
});
