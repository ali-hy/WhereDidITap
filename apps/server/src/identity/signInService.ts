// F-59 signUpOptions (sign-in itself arrives in S-3).
import { acceptedLocales } from "./profileService.js";
import type { IdentityDeps } from "./identityModule.js";

export interface SignUpOptions {
  currencies: { code: string; minorUnits: number }[];
  locales: string[];
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new WeakMap<IdentityDeps, { at: number; value: SignUpOptions }>();

/** Active currencies and the locales a profile accepts; cached for ten minutes. */
export async function signUpOptions(deps: IdentityDeps): Promise<SignUpOptions> {
  const now = deps.clock.now().epochMilliseconds;
  const hit = cache.get(deps);
  if (hit !== undefined && now - hit.at < CACHE_MS) return hit.value;
  const { rows } = await deps.database.handle.executeSql(
    "SELECT code, minor_units FROM currencies WHERE is_active ORDER BY code",
  );
  const value: SignUpOptions = {
    currencies: rows.map((r) => ({
      code: r["code"] as string,
      minorUnits: r["minor_units"] as number,
    })),
    locales: [...acceptedLocales(deps)],
  };
  cache.set(deps, { at: now, value });
  return value;
}
