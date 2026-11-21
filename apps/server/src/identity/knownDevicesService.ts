// F-57: known-device tokens (LD-1).
import type { DbHandle } from "../platform/db/types.js";
import { KNOWN_DEVICE_TTL, MAX_KNOWN_DEVICES } from "./constants.js";
import type { IdentityDeps } from "./identityModule.js";
import * as knownDevicesRepo from "./knownDevicesRepo.js";
import { generateToken, hashToken, parseToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";

/** The device row when the token is valid and belongs to the user with this email. */
export async function checkKnownDevice(
  deps: Pick<IdentityDeps, "clock">,
  h: DbHandle,
  token: string | null,
  email: string,
): Promise<{ id: string; userId: string } | null> {
  const parsed = parseToken("device", token);
  if (parsed === null) return null;
  const now = new Date(deps.clock.now().epochMilliseconds);
  const device = await knownDevicesRepo.findValid(h, hashToken(parsed), now);
  if (device === null) return null;
  const user = await usersRepo.findById(h, device.userId);
  return user?.email === email ? device : null;
}

/** Stores a new device for the user (keeping the most recent MAX_KNOWN_DEVICES) and returns its token. */
export async function issueKnownDevice(
  deps: Pick<IdentityDeps, "clock" | "ids">,
  h: DbHandle,
  userId: string,
): Promise<string> {
  const now = deps.clock.now();
  const token = generateToken("device");
  await knownDevicesRepo.insert(h, {
    id: deps.ids.next(),
    userId,
    tokenHash: hashToken(token),
    lastUsedAt: new Date(now.epochMilliseconds),
    expiresAt: new Date(now.add(KNOWN_DEVICE_TTL).epochMilliseconds),
  });
  await knownDevicesRepo.trimForUser(h, userId, MAX_KNOWN_DEVICES);
  return token;
}
