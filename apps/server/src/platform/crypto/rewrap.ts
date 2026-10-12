// F-117 rewrapApiSecrets (CLI secrets:rewrap-api) and F-118 the platform.capture-rewrap job:
// re-seal every sealed value under the current key.
import { z } from "zod";
import type { ApiContainer, WorkerContainer } from "../container.js";
import { escapeIdentifier } from "../db/escape.js";
import { withTransaction } from "../db/transaction.js";
import type { Database } from "../db/types.js";
import type { Logger } from "../observability/logger.js";
import { defineJob } from "../queue/jobs.js";
import type { ApiSecretsCipher } from "./apiSecrets.js";
import type { CaptureSealer } from "./captureSealer.js";
import type { CaptureUnsealer } from "./captureUnsealer.js";
import type { SealContext } from "./envelope.js";
import type { SealedColumn } from "./sealedColumns.js";

interface RewrapPlan {
  database: Database;
  columns: readonly SealedColumn[];
  currentVersion: string;
  batchSize: number;
  open(envelope: Buffer, ctx: SealContext): Buffer | Promise<Buffer>;
  seal(plaintext: Buffer, ctx: SealContext): Buffer;
}

/** Re-seals every row of `columns` whose key version isn't `currentVersion`. */
async function rewrapColumns(plan: RewrapPlan): Promise<{ rewrapped: number; skipped: number }> {
  let rewrapped = 0;
  let skipped = 0;
  for (const column of plan.columns) {
    const table = escapeIdentifier(column.table);
    const id = escapeIdentifier(column.idColumn);
    const col = escapeIdentifier(column.column);
    // Rows changed concurrently are skipped once; a row still on an old key is tried again in a
    // later batch, so the loop ends when nothing on an old key is left.
    // Ids are kept and bound in the column's own type, so the primary key's index is used.
    const seen: unknown[] = [];
    for (;;) {
      const { rows } = await plan.database.handle.executeSql(
        `SELECT ${id} AS id, ${col} AS sealed FROM ${table}
         WHERE ${col} IS NOT NULL
           AND substring(${col} from 4 for get_byte(${col}, 2)) <> convert_to($1, 'UTF8')
           AND NOT (${id} = ANY($3))
         LIMIT $2`,
        [plan.currentVersion, plan.batchSize, seen],
      );
      const fresh = rows;
      if (fresh.length === 0) break;
      const result = await withTransaction(plan.database, async (tx) => {
        let done = 0;
        let raced = 0;
        for (const row of fresh) {
          const rawId: unknown = row["id"];
          const rowId = String(rawId);
          seen.push(rawId);
          const old = row["sealed"] as Buffer;
          const ctx = { table: column.table, rowId, purpose: column.purpose };
          const plaintext = await plan.open(old, ctx);
          try {
            const sealed = plan.seal(plaintext, ctx);
            const { rowCount } = await tx.executeSql(
              `UPDATE ${table} SET ${col} = $1 WHERE ${id} = $2 AND ${col} = $3`,
              [sealed, rawId, old],
            );
            if (rowCount === 1) done += 1;
            else raced += 1;
          } finally {
            plaintext.fill(0);
          }
        }
        return { done, raced };
      });
      rewrapped += result.done;
      skipped += result.raced;
    }
  }
  return { rewrapped, skipped };
}

/** F-117: the api-provider columns, re-wrapped under the cipher's current key. */
export async function rewrapApiSecrets(deps: {
  database: Database;
  cipher: ApiSecretsCipher;
  columns: readonly SealedColumn[];
  batchSize?: number;
  logger: Logger;
}): Promise<{ rewrapped: number; skipped: number }> {
  const result = await rewrapColumns({
    database: deps.database,
    columns: deps.columns.filter((c) => c.provider === "api"),
    currentVersion: deps.cipher.currentKeyId(),
    batchSize: deps.batchSize ?? 500,
    open: (envelope, ctx) => deps.cipher.unseal(envelope, ctx),
    seal: (plaintext, ctx) => deps.cipher.seal(plaintext, ctx),
  });
  deps.logger.info("api_secrets_rewrap", { count: result.rewrapped });
  return result;
}

/** F-117's command form (A-26): the columns come from the container's registry. */
export async function rewrapApiSecretsCommand(
  c: Pick<ApiContainer, "database" | "apiSecrets" | "sealedColumns" | "logger">,
): Promise<{ rewrapped: number; skipped: number }> {
  return rewrapApiSecrets({
    database: c.database,
    cipher: c.apiSecrets,
    columns: c.sealedColumns.all(),
    logger: c.logger,
  });
}

/** F-118. */
export const captureRewrapJob = defineJob({
  name: "platform.capture-rewrap",
  role: "capture",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 3600,
  policy: "singleton",
});

/** F-118's re-wrap (A-264): capture-provider columns, re-sealed under `keyVersion`. */
export async function rewrapCaptureSecrets(deps: {
  database: Database;
  unsealer: CaptureUnsealer;
  sealer: CaptureSealer;
  columns: readonly SealedColumn[];
  keyVersion: string;
  logger: Logger;
}): Promise<number> {
  const result = await rewrapColumns({
    database: deps.database,
    columns: deps.columns.filter((col) => col.provider === "capture"),
    currentVersion: deps.keyVersion,
    batchSize: 100,
    open: (envelope, ctx) => deps.unsealer.unseal(envelope, ctx),
    seal: (plaintext, ctx) => deps.sealer.seal(plaintext, ctx),
  });
  deps.logger.info("capture_rewrap", { count: result.rewrapped });
  return result.rewrapped;
}

/**
 * F-118's job handler. The local provider doesn't support capture-key rotation (A-264): it
 * re-wraps nothing, warns once and completes. With KMS it re-wraps.
 */
export async function runCaptureRewrapJob(
  c: Pick<
    WorkerContainer,
    "database" | "sealedColumns" | "captureSealer" | "captureUnsealer" | "config"
  >,
  logger: Logger,
): Promise<void> {
  const capture = c.config.capture;
  const sealer = c.captureSealer;
  const unsealer = c.captureUnsealer;
  if (capture === undefined || sealer === null || unsealer === null) {
    throw new Error("capture rewrap needs the capture role");
  }
  if (capture.kms.provider === "local") {
    logger.warn("capture_rewrap_unsupported");
    return;
  }
  await rewrapCaptureSecrets({
    database: c.database,
    unsealer,
    sealer,
    columns: c.sealedColumns.all(),
    keyVersion: capture.keyVersion,
    logger,
  });
}
