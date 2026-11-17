// F-152: the session store. Whether the browser has a session is known from a marker in storage,
// so a first visit makes no request; a returning visit probes `me.get` exactly once.
import type { QueryClient } from "@tanstack/solid-query";
import { createSignal, type Accessor } from "solid-js";
import type { ApiClient } from "../../api/client.js";
import { toAppError } from "../../api/errors.js";
import { safeNext } from "../routes/guards.js";

export type Me = Awaited<ReturnType<ApiClient["me"]["get"]>>;
export type SessionStatus = "loading" | "signed_in" | "signed_out" | "unavailable";

export interface SessionStore {
  status: Accessor<SessionStatus>;
  me: Accessor<Me | null>;
  /** The failed probe's error, while `unavailable`. */
  error: Accessor<unknown>;
  /** True once the session ended during the boot probe (S-3). */
  endedDuringBoot: Accessor<boolean>;
  /** Resolves once the status leaves `loading` (at once when it already has). */
  ready(): Promise<Exclude<SessionStatus, "loading">>;
  boot(): Promise<void>;
  retry(): Promise<void>;
  /** Writes the marker, then re-reads `me`. */
  markSignedIn(): Promise<void>;
  /** Ends the session on the server first; throws, staying signed in, when that fails. */
  signOut(options?: { navigate?: boolean }): Promise<void>;
  /** F-150's `onSessionEnded`: the session is gone without the user asking. */
  sessionEnded(next: string): void;
}

type Storage_ = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SESSION_MARKER = "budmon.session";

export function createSessionStore(deps: {
  api: ApiClient;
  queryClient: QueryClient;
  navigate: (href: string) => void;
  storage?: Storage_ | null;
}): SessionStore {
  const [status, setStatus] = createSignal<SessionStatus>("loading");
  const [me, setMe] = createSignal<Me | null>(null);
  const [error, setError] = createSignal<unknown>(undefined);
  const [endedDuringBoot, setEndedDuringBoot] = createSignal(false);
  const waiting: ((s: Exclude<SessionStatus, "loading">) => void)[] = [];

  const storage = (): Storage_ | null => {
    if (deps.storage !== undefined) return deps.storage;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  /** Blocked or unreadable storage counts as "has a marker", so the probe decides. */
  const hasMarker = (): boolean => {
    try {
      const s = storage();
      return s === null ? true : s.getItem(SESSION_MARKER) !== null;
    } catch {
      return true;
    }
  };
  const writeMarker = (): void => {
    try {
      storage()?.setItem(SESSION_MARKER, "1");
    } catch {
      // Blocked storage: the probe decides on the next visit.
    }
  };
  const removeMarker = (): void => {
    try {
      storage()?.removeItem(SESSION_MARKER);
    } catch {
      // Nothing to remove.
    }
  };

  const settle = (next: Exclude<SessionStatus, "loading">): void => {
    setStatus(next);
    for (const resolve of waiting.splice(0)) resolve(next);
  };

  /** Exactly one request: the default retries would keep the boot screen blank. */
  async function probe(): Promise<void> {
    try {
      const result = await deps.queryClient.query({
        queryKey: ["me"],
        queryFn: () => deps.api.me.get(),
        retry: false,
        staleTime: 0,
      });
      setMe(result);
      setError(undefined);
      settle("signed_in");
    } catch (e) {
      const app = toAppError(e);
      if (app.kind === "defined" && app.key === "UNAUTHENTICATED") {
        removeMarker();
        setMe(null);
        settle("signed_out");
        return;
      }
      setError(e);
      settle("unavailable");
    }
  }

  return {
    status,
    me,
    error,
    endedDuringBoot,
    ready() {
      const current = status();
      if (current !== "loading") return Promise.resolve(current);
      return new Promise((resolve) => waiting.push(resolve));
    },
    async boot() {
      if (!hasMarker()) {
        settle("signed_out");
        return;
      }
      await probe();
    },
    async retry() {
      setStatus("loading");
      await probe();
    },
    async markSignedIn() {
      writeMarker();
      setEndedDuringBoot(false);
      await probe();
    },
    async signOut(options) {
      try {
        await deps.api.auth.signOut({});
      } catch (e) {
        const app = toAppError(e);
        if (!(app.kind === "defined" && app.key === "UNAUTHENTICATED")) throw e;
      }
      removeMarker();
      deps.queryClient.clear();
      setMe(null);
      settle("signed_out");
      if (options?.navigate !== false) deps.navigate("/sign-in");
    },
    sessionEnded(next) {
      removeMarker();
      setMe(null);
      // During the boot probe the guard that awaits `ready()` does the one redirect. The probe's
      // own query stays, so its 401 still reaches `probe`.
      if (status() === "loading") {
        deps.queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
        setEndedDuringBoot(true);
        return;
      }
      deps.queryClient.clear();
      settle("signed_out");
      deps.navigate(`/sign-in?reason=ended&next=${safeNext(next)}`);
    },
  };
}
