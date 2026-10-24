// F-75b (A-227, A-228): row-level security on pgboss.job and pgboss.job_common (schema step 6b, after F-75, as
// budmon_queue). budmon_capture sees and changes only capture jobs, and may enqueue only into
// capture queues and general queues flagged sendableFromCapture; budmon_app reads and sends to any
// queue. Not FORCEd: the owner, budmon_queue (the general worker and the CLI), is unaffected.
import type { DbHandle } from "../db/types.js";
import type { JobRegistry } from "./registry.js";

/** A-228: statements through the partitioned parent see only the parent's policies, so both
 * tables carry the same ones. */
const TABLES = ["pgboss.job", "pgboss.job_common"] as const;
const POLICIES = [
  "capture_select",
  "capture_update",
  "capture_delete",
  "capture_insert",
  "app_select",
  "app_insert",
] as const;

/** A single-quoted SQL string literal. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * A-283, A-296: for each general queue capture may send to, capture's rows must be `created`,
 * carry exactly the queue's job options (as pg-boss's own send writes them), start now or earlier
 * with no priority, group, blocking or dependencies, and not have been retried; with
 * `captureSingletonKeyField`, their singleton key must also be that payload field. Every row
 * column is qualified (`<table>.col`): unqualified, the subquery would resolve it to `q`.
 */
function capturePins(registry: JobRegistry, self: string): string {
  return registry
    .forRole("general")
    .filter((d) => d.sendableFromCapture === true)
    .map((d) => {
      const n = literal(d.name);
      const r = (column: string) => `${self}.${column}`;
      const queueOptions =
        `EXISTS (SELECT 1 FROM pgboss.queue q WHERE q.name = ${n}` +
        ` AND ${r("policy")} IS NOT DISTINCT FROM q.policy` +
        ` AND ${r("retry_limit")} = q.retry_limit` +
        ` AND ${r("retry_delay")} = q.retry_delay` +
        ` AND ${r("retry_backoff")} = COALESCE(q.retry_backoff, false)` +
        ` AND ${r("retry_delay_max")} IS NOT DISTINCT FROM q.retry_delay_max` +
        ` AND ${r("expire_seconds")} = q.expire_seconds` +
        ` AND ${r("deletion_seconds")} = q.deletion_seconds` +
        ` AND ${r("heartbeat_seconds")} IS NOT DISTINCT FROM q.heartbeat_seconds` +
        ` AND ${r("keep_until")} = ${r("start_after")} + q.retention_seconds * interval '1 second')`;
      const key =
        d.captureSingletonKeyField === undefined
          ? ""
          : ` AND ${r("singleton_key")} IS NOT DISTINCT FROM ${r("data")}->>${literal(d.captureSingletonKeyField)}`;
      return (
        ` AND (${r("name")} <> ${n} OR (${r("state")} = 'created'` +
        ` AND ${queueOptions}` +
        ` AND ${r("priority")} = 0` +
        ` AND ${r("start_after")} <= pg_catalog.now()` +
        ` AND ${r("group_id")} IS NULL AND ${r("group_tier")} IS NULL` +
        ` AND NOT ${r("blocked")} AND NOT ${r("blocking")}` +
        ` AND ${r("pending_dependencies")} = 0` +
        ` AND ${r("retry_count")} = 0` +
        `${key}))`
      );
    })
    .join("");
}

/** A SQL array literal of queue names (names follow F-70's pattern; quotes are doubled anyway). */
function nameArray(names: readonly string[]): string {
  const items = [...new Set(names)].sort().map(literal);
  return `ARRAY[${items.join(", ")}]::text[]`;
}

export function queuePolicyStatements(registry: JobRegistry): string[] {
  const own = nameArray([
    ...registry.forRole("capture").map((d) => d.name),
    registry.deadLetterQueue("capture"),
  ]);
  // A-228: SELECT covers what capture may send too (pg-boss sends with INSERT … RETURNING).
  const visible = nameArray([
    ...registry.forRole("capture").map((d) => d.name),
    registry.deadLetterQueue("capture"),
    ...registry
      .forRole("general")
      .filter((d) => d.sendableFromCapture === true)
      .map((d) => d.name),
  ]);
  const statements = ["SET LOCAL ROLE budmon_queue;"];
  for (const table of TABLES) {
    // A-230: the routing columns pg-boss's owner-run paths follow. `<table>.name` is the row's
    // column (unqualified, it would resolve to q.name inside the subquery).
    const self = table.slice(table.indexOf(".") + 1);
    const routing =
      `dead_letter IS NOT DISTINCT FROM (SELECT q.dead_letter FROM pgboss.queue q WHERE q.name = ${self}.name)` +
      ` AND (source_name IS NULL OR source_name = ANY(${own}))`;
    statements.push(
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      ...POLICIES.map((p) => `DROP POLICY IF EXISTS ${p} ON ${table};`),
      `CREATE POLICY capture_select ON ${table} FOR SELECT TO budmon_capture USING (name = ANY(${visible}));`,
      `CREATE POLICY capture_insert ON ${table} FOR INSERT TO budmon_capture WITH CHECK (name = ANY(${visible}) AND ${routing}${capturePins(registry, self)});`,
      `CREATE POLICY capture_update ON ${table} FOR UPDATE TO budmon_capture USING (name = ANY(${own})) WITH CHECK (name = ANY(${own}) AND ${routing});`,
      `CREATE POLICY capture_delete ON ${table} FOR DELETE TO budmon_capture USING (name = ANY(${own}));`,
      `CREATE POLICY app_select ON ${table} FOR SELECT TO budmon_app USING (true);`,
      `CREATE POLICY app_insert ON ${table} FOR INSERT TO budmon_app WITH CHECK (true);`,
    );
  }
  return statements;
}

/** Drops and recreates the policies from the registry, in one implicit transaction. */
export async function applyQueuePolicies(migrator: DbHandle, registry: JobRegistry): Promise<void> {
  await migrator.executeSql(queuePolicyStatements(registry).join("\n"));
}
