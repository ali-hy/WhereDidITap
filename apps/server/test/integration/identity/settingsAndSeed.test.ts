// F-15 settings (TP-0.40) and F-37 the development seeder (TP-0.23, with A-5), plus extra cases
// TP-0.40x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as settingsRepo from "../../../src/identity/settingsRepo.js";
import { identityDevSeeder } from "../../../src/identity/identitySeed.js";
import { userFactory } from "../../factories/identity.js";
import { buildIdentityWorker, T0, type IdentityWorker } from "../../support/identity.js";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../../support/testDatabase.js";

const NOW = Temporal.Instant.from(T0);

describe("TP-0.40: identity_settings and the setUserCap upsert", () => {
  let testDb: TestDatabase;
  let other: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    other = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.drop();
    await other.drop();
  });

  const rows = async (db: TestDatabase) =>
    (await db.database.handle.executeSql("SELECT id, user_cap, updated_at FROM identity_settings"))
      .rows;

  it("TP-0.40: on an empty database, setUserCap(100000) creates the one row; setUserCap(50) updates it and moves updated_at", async () => {
    const h = testDb.database.handle;
    expect(await rows(testDb)).toEqual([]);

    await settingsRepo.setUserCap(h, 100000);
    const first = await rows(testDb);

    expect(await settingsRepo.get(h)).toEqual({ userCap: 100000 });
    expect(first).toHaveLength(1);
    expect(first[0]?.["id"]).toBe(1);

    await settingsRepo.setUserCap(h, 50);
    const second = await rows(testDb);

    expect(await settingsRepo.get(h)).toEqual({ userCap: 50 });
    expect(second).toHaveLength(1);
    expect((second[0]?.["updated_at"] as Date).getTime()).toBeGreaterThan(
      (first[0]?.["updated_at"] as Date).getTime(),
    );
  });

  it("TP-0.40: on another empty database, get alone creates the row with the lazy default 90", async () => {
    expect(await settingsRepo.get(other.database.handle)).toEqual({ userCap: 90 });
    expect((await rows(other)).map((r) => [r["id"], r["user_cap"]])).toEqual([[1, 90]]);
  });

  it("TP-0.40x: getForUpdate also creates the row lazily and returns the cap", async () => {
    await resetBetweenTests(testDb);

    await expect(settingsRepo.getForUpdate(testDb.database.handle)).resolves.toEqual({
      userCap: 90,
    });
    expect(await rows(testDb)).toHaveLength(1);
  });

  it("TP-0.40x: setUserCap(0) is refused by identity_settings_cap", async () => {
    await expect(settingsRepo.setUserCap(testDb.database.handle, 0)).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_settings_cap",
    });
  });
});

describe("TP-0.23: the development seeder", () => {
  let w: IdentityWorker;
  const PASSWORD = "budmon-dev-password-1";

  beforeAll(async () => {
    w = await buildIdentityWorker();
  });

  afterAll(async () => {
    await w.close();
  });

  beforeEach(async () => {
    await resetBetweenTests(w.testDb);
    w.clock.set(T0);
  });

  const users = async () =>
    (
      await w.testDb.database.handle.executeSql(
        `SELECT u.*, p.password_hash FROM users u LEFT JOIN password_credentials p ON p.user_id = u.id ORDER BY u.email`,
      )
    ).rows;
  const count = async (table: string) =>
    (await w.testDb.database.handle.executeSql(`SELECT count(*)::int AS n FROM ${table}`))
      .rows[0]?.["n"];

  it("TP-0.23: is named identity.dev-owner", () => {
    expect(identityDevSeeder.name).toBe("identity.dev-owner");
  });

  it("TP-0.23: run twice on an empty database: the owner and the member with A-5's values; the second run changes nothing", async () => {
    await identityDevSeeder.run(w.container);
    const first = await users();
    await identityDevSeeder.run(w.container);
    const second = await users();

    expect(first.map((u) => u["email"])).toEqual(["member@budmon.local", "owner@budmon.local"]);
    const member = first[0] ?? {};
    const owner = first[1] ?? {};
    expect(owner).toMatchObject({
      display_name: "Dev Owner",
      locale: "en",
      time_zone: "Africa/Cairo",
      base_currency: "EGP",
      status: "active",
      is_product_owner: true,
      invite_allowance: null,
      invited_by_user_id: null,
      last_active_at: null,
    });
    expect(member).toMatchObject({
      display_name: "Dev Member",
      locale: "en",
      time_zone: "Africa/Cairo",
      base_currency: "EGP",
      status: "active",
      is_product_owner: false,
      invite_allowance: 3,
      invited_by_user_id: owner["id"],
      last_active_at: null,
    });
    for (const u of first) {
      expect((u["email_verified_at"] as Date).getTime()).toBe(NOW.epochMilliseconds);
      expect(String(u["password_hash"])).toMatch(/^\$argon2id\$/);
      await expect(
        w.container.identity.deps.hasher.verify(String(u["password_hash"]), PASSWORD),
      ).resolves.toBe(true);
    }
    expect(await count("invitations")).toBe(0);
    expect(await count("sessions")).toBe(0);
    expect(await count("security_events")).toBe(0);
    expect(second.map((u) => [u["id"], u["password_hash"]])).toEqual(
      first.map((u) => [u["id"], u["password_hash"]]),
    );
    expect(await count("users")).toBe(2);
    expect(await count("password_credentials")).toBe(2);
  });

  it("TP-0.23 (b): with another product owner (boss@example.com), no owner@budmon.local; the member is invited by that owner", async () => {
    const boss = await userFactory(w.testDb.database.handle, {
      email: "boss@example.com",
      isProductOwner: true,
    });

    await identityDevSeeder.run(w.container);

    const all = await users();
    expect(all.map((u) => u["email"])).toEqual(["boss@example.com", "member@budmon.local"]);
    expect(all.find((u) => u["email"] === "member@budmon.local")?.["invited_by_user_id"]).toBe(
      boss.id,
    );
  });
});
