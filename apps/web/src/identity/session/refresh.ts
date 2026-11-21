// F-151: the cookie refresh. It uses a client without F-150, so a failed refresh can't recurse.
import { toAppError } from "../../api/errors.js";
import type { ApiClient } from "../../api/client.js";

/** True when the session was refreshed; false when it ended. Network errors and timeouts throw. */
export async function refreshWebSession(client: ApiClient): Promise<boolean> {
  try {
    await client.auth.refresh({ tokenDelivery: "cookie" });
    return true;
  } catch (e) {
    const app = toAppError(e);
    if (
      app.kind === "defined" &&
      (app.key === "REFRESH_INVALID" || app.key === "UNAUTHENTICATED")
    ) {
      return false;
    }
    throw e;
  }
}
