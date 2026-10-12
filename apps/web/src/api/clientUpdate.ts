// A-325: the global "this build is too old" signal, set by F-201 and read by F-210.
import { createSignal, type Accessor } from "solid-js";

const [required, setRequired] = createSignal(false);

/** True once the API has answered CLIENT_UPDATE_REQUIRED; it never goes back. */
export const clientUpdateRequired: Accessor<boolean> = required;

export function markClientUpdateRequired(): void {
  setRequired(true);
}
