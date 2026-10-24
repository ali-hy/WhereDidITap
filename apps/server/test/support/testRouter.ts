// A test contract and router for the API server tests (S-4 AC 1: createApiServer takes a test
// contract and router). The platform contract plus `test.*` procedures implemented directly with
// oRPC, so their handlers can throw what each test needs. Owned by the test-architect.
import {
  CreatedResultSchema,
  base,
  contract,
  createRoute,
  listInput,
  listOutput,
} from "@budmon/contract";
import { CANARIES } from "@budmon/test-support";
import { implement } from "@orpc/server";
import { vi } from "vitest";
import { z } from "zod";
import { RateLimitedError } from "../../src/platform/errors/platformErrors.js";
import type { RequestContext } from "../../src/platform/http/context.js";
import { metaRouter } from "../../src/platform/http/meta.js";
import { procedureBases } from "../../src/platform/http/procedures.js";

export const testContract = {
  ...contract,
  test: {
    ping: base.route({ method: "GET", path: "/test/ping" }).output(z.object({ ok: z.boolean() })),
    rateLimited: base
      .route({ method: "GET", path: "/test/rate-limited" })
      .output(z.object({ ok: z.boolean() })),
    boom: base.route({ method: "GET", path: "/test/boom" }).output(z.object({ ok: z.boolean() })),
    query: base.route({ method: "GET", path: "/test/query" }).output(z.object({ ok: z.boolean() })),
    createThing: createRoute("/test/things").input(z.strictObject({ name: z.string().max(100) })),
    // TP-4.25 (A-148): query coercion of integers and booleans.
    list: base
      .route({ method: "GET", path: "/t/list" })
      .input(listInput({ active: z.boolean().optional() }))
      .output(listOutput(z.string())),
    // TP-4.26 (A-149): a contract-defined error thrown through the typed errors.
    conflict: base
      .route({ method: "GET", path: "/test/conflict" })
      .output(z.object({ ok: z.boolean() })),
    // TP-4.25 (A-165): a body-carrying create whose body has an integer, an amount and a flag.
    createTyped: createRoute("/t/create").input(
      z.strictObject({
        limit: z.number().int().min(1).optional(),
        amountMinor: z.number().int().optional(),
        flag: z.boolean().optional(),
      }),
    ),
    // TP-4.26 (A-166): the same CONFLICT thrown with a custom message.
    conflictCustom: base
      .route({ method: "GET", path: "/test/conflict-custom" })
      .output(z.object({ ok: z.boolean() })),
    // TP-5.2 (A-152): a create whose input keeps unknown keys, to show what the parser removed.
    createLoose: createRoute("/test/loose").input(z.looseObject({ a: z.number().int() })),
  },
};

export interface TestRouter {
  router: Record<string, unknown>;
  /** Called once per invocation of test.createThing's handler. */
  createHandler: ReturnType<typeof vi.fn>;
  /** What test.boom throws. */
  boomError: Error;
  /** The inputs test.list, test.createTyped and test.createLoose received. */
  listInputs: unknown[];
  typedInputs: unknown[];
  looseInputs: unknown[];
}

export function testRouter(boomError: Error = new Error("boom")): TestRouter {
  const os = implement(testContract).$context<RequestContext>();
  const listInputs: unknown[] = [];
  const looseInputs: unknown[] = [];
  const typedInputs: unknown[] = [];
  const createHandler = vi.fn(() => ({
    id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d",
    createdAt: "2026-10-05T12:00:00.000Z",
  }));
  const router = {
    meta: metaRouter,
    test: {
      ping: os.test.ping.handler(() => ({ ok: true })),
      rateLimited: os.test.rateLimited.handler(() => {
        throw new RateLimitedError(30);
      }),
      boom: os.test.boom.handler(() => {
        throw boomError;
      }),
      query: os.test.query.handler(async ({ context }) => {
        await context.container.database.handle.executeSql("SELECT 1");
        return { ok: true };
      }),
      createThing: os.test.createThing.handler(() => CreatedResultSchema.parse(createHandler())),
      list: os.test.list.handler(({ input }) => {
        listInputs.push(input);
        return { items: [], nextCursor: null };
      }),
      conflict: os.test.conflict.handler(({ errors }) => {
        throw errors.CONFLICT({ data: { reason: "taken" } });
      }),
      createTyped: os.test.createTyped.handler(({ input }) => {
        typedInputs.push(input);
        return CreatedResultSchema.parse(createHandler());
      }),
      conflictCustom: os.test.conflictCustom.handler(({ errors }) => {
        throw errors.CONFLICT({
          message: "custom " + CANARIES.payee,
          data: { reason: "taken" },
        });
      }),
      createLoose: os.test.createLoose.handler(({ input }) => {
        looseInputs.push(input);
        return CreatedResultSchema.parse(createHandler());
      }),
    },
  };
  return {
    router,
    createHandler,
    boomError,
    listInputs,
    typedInputs,
    looseInputs,
  };
}

const PrincipalEcho = z.object({ userId: z.string(), isOwner: z.boolean(), sessionId: z.string() });

/**
 * TP-4.8 and TP-4.16's contract: the platform contract plus authed and owner procedures, built on
 * F-53's bases for this contract (A-123, procedureBases).
 */
export const authContract = {
  ...contract,
  test: {
    authedThing: base.route({ method: "GET", path: "/test/authed-thing" }).output(PrincipalEcho),
    ownerThing: base.route({ method: "GET", path: "/test/owner-thing" }).output(PrincipalEcho),
    createThing: createRoute("/test/things").input(z.strictObject({ name: z.string().max(100) })),
  },
};

/** Handlers echo ctx.principal unchanged; createThing returns a fixed CreatedResult. */
export function authRouter(): Record<string, unknown> {
  const { authedProcedure, ownerProcedure } = procedureBases(authContract);
  const echo = ({
    context,
  }: {
    context: { principal: { userId: string; isOwner: boolean; sessionId: string } };
  }) => ({
    userId: context.principal.userId,
    isOwner: context.principal.isOwner,
    sessionId: context.principal.sessionId,
  });
  return {
    meta: metaRouter,
    test: {
      authedThing: authedProcedure.test.authedThing.handler(echo),
      ownerThing: ownerProcedure.test.ownerThing.handler(echo),
      createThing: authedProcedure.test.createThing.handler(() => ({
        id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d",
        createdAt: "2026-10-05T12:00:00.000Z",
      })),
    },
  };
}
