// The sign-in prompt's "Create new codes" action: kept in memory, so no URL carries it.
import { createSignal } from "solid-js";

const [requested, setRequested] = createSignal(false);

/** Asks Sign-in & security to create new codes when it opens. */
export function requestNewCodes(): void {
  setRequested(true);
}

/** True once per request; clears it. */
export function takeNewCodesRequest(): boolean {
  const was = requested();
  setRequested(false);
  return was;
}

export const newCodesRequested = requested;
