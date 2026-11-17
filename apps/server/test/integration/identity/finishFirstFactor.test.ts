// F-51 finishFirstFactor called directly, as F-86 (S-6) will call it: the pending Google link's
// 23505 race, and step 0's closure re-check under the user lock (identity LLD §4.4). TP-3.30, plus
// extra cases TP-3.31x (TP-3.31 itself verifies a two-step code, which needs S-4's F-52).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommitTracker } from "../../../src/platform/db/transaction.js";
import type { DbHandle } from "../../../src/platform/db/types.js";
import {
  AccountClosedError,
  GoogleAccountInUseError,
} from "../../../src/identity/identityErrors.js";
import type { IdentityDeps } from "../../../src/identity/identityModule.js";
import type { ReqInfo } from "../../../src/identity/sessionService.js";
import { finishFirstFactor } from "../../../src/identity/signInService.js";
import * as usersRepo from "../../../src/identity/usersRepo.js";
import type { UserRow } from "../../../src/identity/usersRepo.js";
import { banFactory, passwordFactory, userFactory } from "../../factories/identity.js";
import { buildIdentityApi, T0, type IdentityApi } from "../../support/identity.js";
import { nextIp, TAILNET } from "../../support/identityHttp.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

let api: IdentityApi;
let deps: IdentityDeps;
let h: DbHandle;
const NOW = Temporal.Instant.from(T0);

beforeAll(async () => {
  api = await buildIdentityApi();
  await api.container.boss.start();
  deps = api.container.identity.deps;
  h = api.testDb.database.handle;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
  api.clock.set(T0);
});

const req = (): ReqInfo => ({
  ip: nextIp(),
  clientKind: "android",
  userAgent: null,
  origin: null,
  host: TAILNET,
  cookies: {},
  deviceModel: null,
  presentedDeviceToken: null,
  tracker: createCommitTracker(),
  requestId: "req-s3-finish-first-factor",
});

const countRows = async (sql: string, params: unknown[]): Promise<number> =>
  (await h.executeSql(sql, params)).rows[0]?.["n"] as number;

const sessionsOf = (userId: string) =>
  countRows("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1", [userId]);

describe("TP-3.30: the pending-link race", () => {
  it("TP-3.30: two concurrent finishFirstFactor calls with the same pending Google link → one signed_in with the link, the other GOOGLE_ACCOUNT_IN_USE; one google_identities row; one session", async () => {
    const user = await userFactory(h, { email: "mona.race@example.com" });
    const pendingLink = { sub: "google-sub-race-1", email: user.email };
    const run = () =>
      finishFirstFactor(
        deps,
        { user, method: "google", pendingLink, delivery: "bearer", presentedDeviceToken: null },
        req(),
      );

    const results = await Promise.allSettled([run(), run()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toMatchObject({ status: "signed_in", recoveryCodesLeft: null });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(GoogleAccountInUseError);
    expect(rejected[0]?.reason).toMatchObject({ key: "GOOGLE_ACCOUNT_IN_USE", status: 409 });
    const { rows } = await h.executeSql(
      "SELECT user_id, google_sub, email_at_link FROM google_identities",
    );
    expect(rows).toEqual([
      { user_id: user.id, google_sub: "google-sub-race-1", email_at_link: user.email },
    ]);
    expect(await sessionsOf(user.id)).toBe(1);
  });

  it("TP-3.30x: the winning call records google_linked_auto and sign_in_succeeded, and its session's auth method is google", async () => {
    const user = await userFactory(h);

    const outcome = await finishFirstFactor(
      deps,
      {
        user,
        method: "google",
        pendingLink: { sub: "google-sub-x", email: user.email },
        delivery: "bearer",
        presentedDeviceToken: null,
      },
      req(),
    );

    expect(outcome.status).toBe("signed_in");
    const kinds = (
      await h.executeSql("SELECT kind FROM security_events WHERE user_id = $1 ORDER BY kind", [
        user.id,
      ])
    ).rows.map((r) => r["kind"]);
    expect(kinds).toEqual(["google_linked_auto", "sign_in_succeeded"]);
    const { rows } = await h.executeSql("SELECT auth_method FROM sessions WHERE user_id = $1", [
      user.id,
    ]);
    expect(rows).toEqual([{ auth_method: "google" }]);
  });
});

describe("TP-3.31x: completeSignIn's step 0 re-checks closure under the user lock", () => {
  /** The user row as a first factor read it, before the change that follows. */
  async function staleRow(): Promise<UserRow> {
    const user = await userFactory(h);
    await passwordFactory(h, user.id);
    return user;
  }

  const finish = (user: UserRow) =>
    finishFirstFactor(
      deps,
      {
        user,
        method: "password",
        pendingLink: null,
        delivery: "bearer",
        presentedDeviceToken: null,
      },
      req(),
    );

  it("TP-3.31x: the email banned after the first factor read the user → ACCOUNT_CLOSED, no session", async () => {
    const user = await staleRow();
    await banFactory(h, { email: user.email, now: NOW });

    const err: unknown = await finish(user).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AccountClosedError);
    expect(await sessionsOf(user.id)).toBe(0);
  });

  it.each(["owner", "ban"] as const)(
    "TP-3.31x: a deletion requested by %s after the first factor (F-8 setDeletion) → ACCOUNT_CLOSED, no session",
    async (requestedBy) => {
      const user = await staleRow();
      await usersRepo.setDeletion(h, user.id, {
        requestedAt: new Date(NOW.epochMilliseconds),
        scheduledFor: new Date(NOW.add({ hours: 24 * 7 }).epochMilliseconds),
        requestedBy,
      });

      const err: unknown = await finish(user).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AccountClosedError);
      expect(await sessionsOf(user.id)).toBe(0);
    },
  );

  it("TP-3.31x: the user deleted after the first factor → ACCOUNT_CLOSED", async () => {
    const user = await staleRow();
    await usersRepo.deleteById(h, user.id);

    await expect(finish(user)).rejects.toBeInstanceOf(AccountClosedError);
  });

  it("TP-3.31x: self-requested deletion after the first factor still signs in", async () => {
    const user = await staleRow();
    await usersRepo.setDeletion(h, user.id, {
      requestedAt: new Date(NOW.epochMilliseconds),
      scheduledFor: new Date(NOW.add({ hours: 24 * 7 }).epochMilliseconds),
      requestedBy: "self",
    });

    await expect(finish(user)).resolves.toMatchObject({ status: "signed_in" });
  });
});
