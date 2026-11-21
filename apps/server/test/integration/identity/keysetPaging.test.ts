// Keyset paging over rows created in one transaction (A-15). TP-0.41: F-8 listPage, F-13
// listByInviter and listAll, each paged with limit 1.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../../src/platform/db/transaction.js";
import * as invitationsRepo from "../../../src/identity/invitationsRepo.js";
import * as usersRepo from "../../../src/identity/usersRepo.js";
import { invitationFactory, userFactory } from "../../factories/identity.js";
import { T0 } from "../../support/identity.js";
import {
  createTestDatabase,
  resetBetweenTests,
  type TestDatabase,
} from "../../support/testDatabase.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_app");
});

afterAll(async () => {
  await testDb.drop();
});

beforeEach(async () => {
  await resetBetweenTests(testDb);
});

type Cursor = { createdAt: Date; id: string };
type Page<R extends Cursor> = (after: Cursor | null) => Promise<R[]>;

/** Pages with limit 1 until an empty page; returns every page (the last one is []). */
async function allPages<R extends Cursor>(page: Page<R>, maxPages = 10): Promise<R[][]> {
  const pages: R[][] = [];
  let after: Cursor | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const rows = await page(after);
    pages.push(rows);
    const last = rows.at(-1);
    if (last === undefined) break;
    after = { createdAt: last.createdAt, id: last.id };
  }
  return pages;
}

/** created_at desc, id desc for rows that tie on created_at: ids descending (uuid order). */
const byIdDesc = (ids: string[]): string[] => [...ids].sort().reverse();

const now = Temporal.Instant.from(T0);

describe("TP-0.41: keyset paging over rows created in one transaction (A-15)", () => {
  it("TP-0.41: usersRepo.listPage returns each of three tied users once, then []", async () => {
    const created = await withTransaction(testDb.database, async (tx) => [
      await userFactory(tx),
      await userFactory(tx),
      await userFactory(tx),
    ]);
    expect(new Set(created.map((u) => u.createdAt.getTime())).size).toBe(1);

    const pages = await allPages((after) =>
      usersRepo.listPage(testDb.database.handle, { after, limit: 1 }),
    );

    expect(pages.map((p) => p.map((u) => u.id))).toEqual([
      ...byIdDesc(created.map((u) => u.id)).map((id) => [id]),
      [],
    ]);
  });

  it("TP-0.41: invitationsRepo.listByInviter returns each of three tied invitations once, then []", async () => {
    const inviter = await userFactory(testDb.database.handle);
    const ids = await withTransaction(testDb.database, async (tx) => [
      (await invitationFactory(tx, { email: "a@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
      (await invitationFactory(tx, { email: "b@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
      (await invitationFactory(tx, { email: "c@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
    ]);

    const pages = await allPages((after) =>
      invitationsRepo.listByInviter(testDb.database.handle, inviter.id, { after, limit: 1 }),
    );

    expect(new Set(pages.flat().map((r) => r.createdAt.getTime())).size).toBe(1);
    expect(pages.map((p) => p.map((r) => r.id))).toEqual([...byIdDesc(ids).map((id) => [id]), []]);
  });

  it("TP-0.41: invitationsRepo.listAll returns each of three tied invitations once, then []", async () => {
    const inviter = await userFactory(testDb.database.handle);
    const ids = await withTransaction(testDb.database, async (tx) => [
      (await invitationFactory(tx, { email: "a@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
      (await invitationFactory(tx, { email: "b@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
      (await invitationFactory(tx, { email: "c@example.invalid", now, inviterUserId: inviter.id }))
        .invitationId,
    ]);

    const pages = await allPages((after) =>
      invitationsRepo.listAll(testDb.database.handle, { after, limit: 1 }),
    );

    expect(new Set(pages.flat().map((r) => r.createdAt.getTime())).size).toBe(1);
    expect(pages.map((p) => p.map((r) => r.id))).toEqual([...byIdDesc(ids).map((id) => [id]), []]);
  });
});
