// Identity's tables (identity LLD §3.1, §3.2) in the pushed template. TP-0.7, TP-0.8, TP-0.10, plus
// extra cases TP-0.7x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { uuidv7Generator } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/platform/db/types.js";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../../support/testDatabase.js";

let testDb: TestDatabase;
let capture: Database;
let migrator: Database;
const id = () => uuidv7Generator.next();

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_app");
  capture = testDb.connectAs("budmon_capture");
  migrator = testDb.connectAs("budmon_migrator");
});

afterAll(async () => {
  await capture.close();
  await migrator.close();
  await testDb.drop();
});

beforeEach(async () => {
  await resetBetweenTests(testDb);
});

/** Identity's 15 tables (§3.1). */
const IDENTITY_TABLES = [
  "auth_challenges",
  "data_exports",
  "email_bans",
  "google_identities",
  "identity_settings",
  "invitations",
  "known_devices",
  "password_credentials",
  "password_resets",
  "recovery_codes",
  "security_events",
  "session_refresh_tokens",
  "sessions",
  "two_step_credentials",
  "users",
] as const;

/** The pg error a statement fails with (code and constraint), or null when it succeeds. */
async function failure(
  sql: string,
  values: readonly unknown[] = [],
  db: Database = testDb.database,
): Promise<{ code: string; constraint: string | undefined } | null> {
  try {
    await db.handle.executeSql(sql, values);
    return null;
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    return { code: String(e.code), constraint: e.constraint };
  }
}

async function insertUser(
  over: { id?: string; email?: string; owner?: boolean } = {},
): Promise<string> {
  const userId = over.id ?? id();
  await testDb.database.handle.executeSql(
    "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency, is_product_owner) VALUES ($1, $2, 'U', 'en', 'UTC', 'USD', $3)",
    [userId, over.email ?? `u-${userId}@example.invalid`, over.owner ?? false],
  );
  return userId;
}

describe("TP-0.7: schema constraints", () => {
  it("TP-0.7: an upper-case email fails users_email_format", async () => {
    expect(
      await failure(
        "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, 'Mona@Example.com', 'M', 'en', 'UTC', 'USD')",
        [id()],
      ),
    ).toEqual({ code: "23514", constraint: "users_email_format" });
  });

  it("TP-0.7: status pending_deletion without dates fails users_deletion_consistent", async () => {
    expect(
      await failure(
        "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency, status) VALUES ($1, 'p@example.com', 'P', 'en', 'UTC', 'USD', 'pending_deletion')",
        [id()],
      ),
    ).toEqual({ code: "23514", constraint: "users_deletion_consistent" });
  });

  it("TP-0.7: a second owner fails users_single_owner", async () => {
    await insertUser({ owner: true });

    const error = await failure(
      "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency, is_product_owner) VALUES ($1, 'o2@example.com', 'O', 'en', 'UTC', 'USD', true)",
      [id()],
    );

    expect(error).toEqual({ code: "23505", constraint: "users_single_owner" });
  });

  it("TP-0.7: a second pending invitation for one email fails invitations_pending_email_key", async () => {
    const insert =
      "INSERT INTO invitations (id, email, origin, expires_at) VALUES ($1, 'x@example.com', 'direct', now() + interval '7 days')";
    await testDb.database.handle.executeSql(insert, [id()]);

    expect(await failure(insert, [id()])).toEqual({
      code: "23505",
      constraint: "invitations_pending_email_key",
    });
  });

  it("TP-0.7: a second active export for one user fails data_exports_one_active_key", async () => {
    const userId = await insertUser();
    const insert =
      "INSERT INTO data_exports (id, user_id, status, requested_at) VALUES ($1, $2, $3, now())";
    await testDb.database.handle.executeSql(insert, [id(), userId, "queued"]);

    expect(await failure(insert, [id(), userId, "running"])).toEqual({
      code: "23505",
      constraint: "data_exports_one_active_key",
    });
  });

  it("TP-0.7: two_step_credentials enabled without a secret fails two_step_pending_shape", async () => {
    const userId = await insertUser();

    expect(
      await failure(
        "INSERT INTO two_step_credentials (user_id, state, enabled_at) VALUES ($1, 'enabled', now())",
        [userId],
      ),
    ).toEqual({ code: "23514", constraint: "two_step_pending_shape" });
  });

  it("TP-0.7 (A-15): every timestamptz column of identity's 15 tables has precision 3", async () => {
    const { rows } = await testDb.database.handle.executeSql(
      "SELECT table_name, column_name, datetime_precision FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'timestamp with time zone' AND table_name = ANY($1)",
      [[...IDENTITY_TABLES]],
    );
    const columns = rows.map((r) => ({
      column: `${String(r["table_name"])}.${String(r["column_name"])}`,
      precision: Number(r["datetime_precision"]),
    }));

    expect(new Set(columns.map((c) => c.column.split(".")[0]))).toEqual(new Set(IDENTITY_TABLES));
    expect(columns.filter((c) => c.precision !== 3)).toEqual([]);
  });

  it("TP-0.7: sessions has exactly §3.1's 16 columns, and no absolute_expires_at", async () => {
    const { rows } = await testDb.database.handle.executeSql(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions'",
    );
    const columns = rows.map((r) => String(r["column_name"])).sort();

    expect(columns).toEqual(
      [
        "id",
        "user_id",
        "delivery",
        "client_kind",
        "device_label",
        "auth_method",
        "access_token_hash",
        "access_expires_at",
        "current_refresh_id",
        "idle_expires_at",
        "confirmed_at",
        "last_used_at",
        "revoked_at",
        "revoke_reason",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns).not.toContain("absolute_expires_at");
  });
});

describe("TP-0.7x: more of §3.1's constraints", () => {
  it("TP-0.7x: a duplicate email fails users_email_key", async () => {
    await insertUser({ email: "dup@example.com" });

    expect(
      await failure(
        "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, 'dup@example.com', 'D', 'en', 'UTC', 'USD')",
        [id()],
      ),
    ).toEqual({ code: "23505", constraint: "users_email_key" });
  });

  it("TP-0.7x: an unknown base currency fails the currencies FK", async () => {
    const error = await failure(
      "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, 'c@example.com', 'C', 'en', 'UTC', 'XXX')",
      [id()],
    );

    expect(error?.code).toBe("23503");
  });

  it.each([
    ["an empty display name", "''", "users_display_name_len"],
    ["an 81-character display name", `'${"x".repeat(81)}'`, "users_display_name_len"],
  ])("TP-0.7x: %s fails %s", async (_label, name, constraint) => {
    expect(
      await failure(
        `INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, 'n@example.com', ${name}, 'en', 'UTC', 'USD')`,
        [id()],
      ),
    ).toEqual({ code: "23514", constraint });
  });

  it("TP-0.7x: a negative invite allowance fails users_allowance_nonneg", async () => {
    expect(
      await failure(
        "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency, invite_allowance) VALUES ($1, 'a@example.com', 'A', 'en', 'UTC', 'USD', -1)",
        [id()],
      ),
    ).toEqual({ code: "23514", constraint: "users_allowance_nonneg" });
  });

  it("TP-0.7x: a user's defaults are status active, not the owner, allowance 3", async () => {
    const userId = await insertUser();

    const { rows } = await testDb.database.handle.executeSql(
      "SELECT status, is_product_owner, invite_allowance FROM users WHERE id = $1",
      [userId],
    );

    expect(rows[0]).toEqual({ status: "active", is_product_owner: false, invite_allowance: 3 });
  });

  it("TP-0.7x: a password hash that isn't argon2id fails password_credentials_phc", async () => {
    const userId = await insertUser();

    expect(
      await failure(
        "INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, '$2b$10$x')",
        [userId],
      ),
    ).toEqual({ code: "23514", constraint: "password_credentials_phc" });
  });

  it("TP-0.7x: a revoked session without a valid reason fails sessions_revoke_reason", async () => {
    const userId = await insertUser();

    const error = await failure(
      `INSERT INTO sessions (id, user_id, delivery, client_kind, device_label, auth_method, access_token_hash,
         access_expires_at, current_refresh_id, idle_expires_at, last_used_at, revoked_at, revoke_reason)
       VALUES ($1, $2, 'bearer', 'android', 'Android', 'password', decode(repeat('00', 32), 'hex'),
         now(), $3, now(), now(), now(), 'bored')`,
      [id(), userId, id()],
    );

    expect(error).toEqual({ code: "23514", constraint: "sessions_revoke_reason" });
  });

  it("TP-0.7x: a second identity_settings row fails identity_settings_singleton", async () => {
    expect(await failure("INSERT INTO identity_settings (id, user_cap) VALUES (2, 90)")).toEqual({
      code: "23514",
      constraint: "identity_settings_singleton",
    });
  });

  it("TP-0.7x: an unknown security event kind fails security_events_kind", async () => {
    const userId = await insertUser();

    expect(
      await failure("INSERT INTO security_events (id, user_id, kind) VALUES ($1, $2, 'made_up')", [
        id(),
        userId,
      ]),
    ).toEqual({ code: "23514", constraint: "security_events_kind" });
  });

  it("TP-0.7x: a bootstrap invitation with an inviter fails invitations_bootstrap_no_inviter", async () => {
    const userId = await insertUser();

    expect(
      await failure(
        "INSERT INTO invitations (id, email, origin, inviter_user_id, expires_at) VALUES ($1, 'b@example.com', 'bootstrap', $2, now())",
        [id(), userId],
      ),
    ).toEqual({ code: "23514", constraint: "invitations_bootstrap_no_inviter" });
  });
});

describe("TP-0.8: budmon_capture reads users and nothing else of identity's", () => {
  it("TP-0.8: SELECT on users is allowed", async () => {
    await expect(capture.handle.executeSql("SELECT id FROM users LIMIT 1")).resolves.toBeDefined();
  });

  it.each([
    "password_credentials",
    "google_identities",
    "two_step_credentials",
    "recovery_codes",
    "sessions",
    "session_refresh_tokens",
    "known_devices",
    "auth_challenges",
    "password_resets",
    "invitations",
    "email_bans",
    "identity_settings",
    "security_events",
    "data_exports",
  ])("TP-0.8: SELECT on %s is 42501", async (table) => {
    expect((await failure(`SELECT 1 FROM ${table} LIMIT 1`, [], capture))?.code).toBe("42501");
  });

  it("TP-0.7x: budmon_capture can't write users (SELECT only, DV-4)", async () => {
    expect(
      (
        await failure(
          "INSERT INTO users (id, email, display_name, locale, time_zone, base_currency) VALUES ($1, 'w@example.com', 'W', 'en', 'UTC', 'USD')",
          [id()],
          capture,
        )
      )?.code,
    ).toBe("42501");
  });
});

describe("TP-0.10: idempotency_records.user_id references users (cascade)", () => {
  it("TP-0.10: deleting the user deletes its idempotency record", async () => {
    const userId = await insertUser();
    await testDb.database.handle.executeSql(
      "INSERT INTO idempotency_records (user_id, idempotency_key, procedure, request_hash, expires_at) VALUES ($1, $2, 'p', decode(repeat('00', 32), 'hex'), now() + interval '1 day')",
      [userId, id()],
    );

    await testDb.database.handle.executeSql("DELETE FROM users WHERE id = $1", [userId]);

    const { rows } = await testDb.database.handle.executeSql(
      "SELECT count(*)::int AS n FROM idempotency_records WHERE user_id = $1",
      [userId],
    );
    expect(rows[0]?.["n"]).toBe(0);
  });
});
