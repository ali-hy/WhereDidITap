// The sign-in prompt's "Create new codes" action: kept in memory, so no URL carries it. It is
// tied to the user who asked and lapses after a short time.
import { createSignal } from "solid-js";

interface Request {
  userId: string;
  at: number;
}

export const NEW_CODES_REQUEST_TTL_MS = 30_000;

const [request, setRequest] = createSignal<Request | null>(null);

/** Asks Sign-in & security to create new codes when it opens; replaces any earlier request. */
export function requestNewCodes(userId: string): void {
  setRequest({ userId, at: performance.now() });
}

export const newCodesRequested = (): boolean => request() !== null;

/** Always clears the request; true only for the same user, within the time limit. */
export function takeNewCodesRequest(userId: string | undefined): boolean {
  const taken = request();
  setRequest(null);
  return (
    taken !== null &&
    taken.userId === userId &&
    performance.now() - taken.at < NEW_CODES_REQUEST_TTL_MS
  );
}

export function clearNewCodesRequest(): void {
  setRequest(null);
}
