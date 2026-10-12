// F-100 createIdempotency and F-102 runIdempotentCreate: a create replays its first result for
// the same Idempotency-Key, inside the caller's transaction.
import { createHash } from "node:crypto";
import { canonicalJson, isUuid, Temporal, toInstantWire, type Clock } from "@budmon/shared";
import { withTransaction } from "../db/transaction.js";
import type { DbHandle } from "../db/types.js";
import { IdempotencyKeyReusedError, ValidationFailedError } from "../errors/platformErrors.js";
import type { Principal, RequestContext } from "../http/context.js";
import type { PlatformMetrics } from "../observability/metrics.js";
import { complete, find, insertIfAbsent } from "./idempotencyRepo.js";

export interface CreatedResult {
  id: string;
  createdAt: Temporal.Instant;
}

export interface Idempotency {
  run(
    h: DbHandle,
    req: { userId: string; key: string; procedure: string; input: unknown },
    work: () => Promise<CreatedResult>,
  ): Promise<{ result: CreatedResult; replayed: boolean; status: 201 }>;
}

const RECORD_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** A-233: sha256(canonicalJson(input)), over the procedure's validated input. */
export function requestHashOf(input: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(input)).digest();
}

export function createIdempotency(deps: { clock: Clock; metrics: PlatformMetrics }): Idempotency {
  return {
    async run(h, req, work) {
      if (!h.inTransaction) throw new Error("idempotency requires a transaction");
      // The validated input (wire values, after zod defaults).
      const requestHash = requestHashOf(req.input);
      const record = {
        userId: req.userId,
        key: req.key,
        procedure: req.procedure,
        requestHash,
        expiresAt: new Date(deps.clock.now().epochMilliseconds + RECORD_LIFETIME_MS),
      };
      const fresh = async (): Promise<{
        result: CreatedResult;
        replayed: false;
        status: 201;
      }> => {
        const result = await work();
        await complete(h, req.userId, req.key, 201, {
          id: result.id,
          createdAt: toInstantWire(result.createdAt),
        });
        return { result, replayed: false, status: 201 };
      };
      if (await insertIfAbsent(h, record)) return fresh();
      // An existing row (a concurrent duplicate waited on the primary key until the first
      // transaction ended).
      let existing = await find(h, req.userId, req.key);
      if (existing === null) {
        // A-239: the conflicting row went away (its transaction rolled back, or it was purged):
        // try once more.
        if (await insertIfAbsent(h, record)) return fresh();
        existing = await find(h, req.userId, req.key);
        if (existing === null) throw new Error("idempotency record vanished");
      }
      if (existing.procedure !== req.procedure || !existing.requestHash.equals(requestHash)) {
        throw new IdempotencyKeyReusedError();
      }
      if (existing.responseStatus === null || existing.result === null) {
        throw new Error("idempotency record incomplete");
      }
      deps.metrics.idempotentReplays.add(1, {});
      return {
        result: {
          id: existing.result.id,
          createdAt: Temporal.Instant.from(existing.result.createdAt),
        },
        replayed: true,
        status: 201,
      };
    },
  };
}

/** F-102: the router helper every create procedure uses. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- F-102's signature
export async function runIdempotentCreate<I>(
  ctx: RequestContext & { principal: Principal },
  procedure: string,
  input: I,
  work: (tx: DbHandle) => Promise<CreatedResult>,
): Promise<{ id: string; createdAt: string }> {
  const key = ctx.headers["idempotency-key"];
  if (key === undefined || !isUuid(key)) {
    throw new ValidationFailedError([
      {
        path: ["headers", "idempotency-key"],
        code: "invalid_idempotency_key",
        message: "Idempotency-Key must be a UUID",
      },
    ]);
  }
  const { idempotency, database } = ctx.container;
  const { result, replayed } = await withTransaction(
    database,
    (tx) =>
      idempotency.run(tx, { userId: ctx.principal.userId, key, procedure, input }, () => work(tx)),
    { tracker: ctx.commitTracker },
  );
  if (replayed) ctx.responseHeaders.set("Idempotent-Replayed", "true");
  return { id: result.id, createdAt: toInstantWire(result.createdAt) };
}
