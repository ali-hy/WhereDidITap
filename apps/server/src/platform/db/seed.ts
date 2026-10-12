// F-23: the seed framework. Each seeder is idempotent.
import { utcDateOf } from "@budmon/shared";
import type { WorkerContainer } from "../container.js";
import { normaliseRate } from "../fx/decimal.js";
import { insertDay } from "../fx/fxRepo.js";
import { createFixedProvider } from "../fx/providers.js";

export interface Seeder {
  name: string;
  run(c: WorkerContainer): Promise<void>;
}

const SEEDED_DAYS = 30;

/**
 * Development only: the fixed provider's rates for the 30 days before today (UTC, the container's
 * clock), provider `fixed` (A-270). Stored days are kept, so a second run inserts nothing.
 */
export const fxRatesSeeder: Seeder = {
  name: "platform.fx-rates",
  async run(c) {
    const provider = createFixedProvider();
    const today = utcDateOf(c.clock.now());
    const fetchedAt = new Date(c.clock.now().epochMilliseconds);
    for (let back = SEEDED_DAYS; back >= 1; back -= 1) {
      const rateDate = today.subtract({ days: back }).toString();
      const rates = await provider.fetchDay(rateDate, new AbortController().signal);
      const rows = [...rates].map(([code, raw]) => ({
        code,
        unitsPerUsd: normaliseRate(raw) ?? raw,
      }));
      await insertDay(c.database.handle, rows, rateDate, provider.name, fetchedAt);
    }
  },
};

/** The platform's seeders. */
export const seeders: Seeder[] = [fxRatesSeeder];

export async function runSeeders(
  c: WorkerContainer,
  list: readonly Seeder[] = seeders,
): Promise<void> {
  for (const seeder of list) {
    await seeder.run(c);
  }
}
