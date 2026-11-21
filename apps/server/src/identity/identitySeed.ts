// F-37: the development seeder (§3.3): an owner and a member, each with a password.
import type { Seeder } from "../platform/db/seed.js";
import { withTransaction } from "../platform/db/transaction.js";
import * as credentialsRepo from "./credentialsRepo.js";
import { DEFAULT_INVITE_ALLOWANCE } from "./constants.js";
import * as usersRepo from "./usersRepo.js";

const DEV_PASSWORD = "budmon-dev-password-1";
const OWNER_EMAIL = "owner@budmon.local";
const MEMBER_EMAIL = "member@budmon.local";

/** Idempotent by email; the owner is skipped when another product owner exists. */
export const identityDevSeeder: Seeder = {
  name: "identity.dev-owner",
  async run(c) {
    const deps = c.identity.deps;
    const now = new Date(deps.clock.now().epochMilliseconds);
    const h = deps.database.handle;

    async function create(
      email: string,
      displayName: string,
      extra: {
        isProductOwner: boolean;
        inviteAllowance: number | null;
        invitedByUserId: string | null;
      },
    ): Promise<void> {
      if ((await usersRepo.findByEmail(h, email)) !== null) return;
      const id = deps.ids.next();
      const hash = await deps.hasher.hash(DEV_PASSWORD);
      await withTransaction(deps.database, async (tx) => {
        await usersRepo.insert(tx, {
          id,
          email,
          emailVerifiedAt: now,
          displayName,
          locale: "en",
          timeZone: "Africa/Cairo",
          baseCurrency: "EGP",
          status: "active",
          deletionRequestedAt: null,
          deletionScheduledFor: null,
          deletionRequestedBy: null,
          ...extra,
        });
        await credentialsRepo.upsertPassword(tx, id, hash);
      });
    }

    if ((await usersRepo.findOwner(h)) === null) {
      await create(OWNER_EMAIL, "Dev Owner", {
        isProductOwner: true,
        inviteAllowance: null,
        invitedByUserId: null,
      });
    }
    await create(MEMBER_EMAIL, "Dev Member", {
      isProductOwner: false,
      inviteAllowance: DEFAULT_INVITE_ALLOWANCE,
      invitedByUserId: (await usersRepo.findOwner(h))?.id ?? null,
    });
  },
};
