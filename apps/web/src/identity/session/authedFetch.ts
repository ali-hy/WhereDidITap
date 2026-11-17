// F-150: the API client's fetch. A 401 UNAUTHENTICATED triggers one refresh (single-flight across
// requests and tabs), then one retry.

const REFRESH_LOCK = "budmon-refresh";

/** The JSON envelope's `code` of an error response, or null when it isn't one. */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * A body is read once, so the request can be sent twice and still goes out as a plain buffer (a
 * cloned stream would be sent chunked).
 */
async function replayable(input: RequestInfo | URL): Promise<() => RequestInfo | URL> {
  if (!(input instanceof Request) || input.body === null) return () => input;
  const body = await input.arrayBuffer();
  return () =>
    new Request(input.url, {
      method: input.method,
      headers: input.headers,
      body,
      credentials: input.credentials,
      cache: input.cache,
      redirect: input.redirect,
      signal: input.signal,
    });
}

const pathOf = (input: RequestInfo | URL): string => {
  if (input instanceof Request) return new URL(input.url, location.href).pathname;
  return new URL(String(input), location.href).pathname;
};

export function createAuthedFetch(
  inner: typeof fetch,
  opts: {
    refresh: () => Promise<boolean>;
    onSessionEnded: () => void;
    locks?: LockManager;
  },
): typeof fetch {
  // Counts refreshes that succeeded, so a late 401 from before one only retries.
  let epoch = 0;
  let inflight: Promise<boolean> | null = null;

  const runRefresh = async (): Promise<boolean> => {
    const locks = opts.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
    const run = async (): Promise<boolean> => {
      const ok = await opts.refresh();
      if (ok) epoch += 1;
      return ok;
    };
    return locks === undefined ? run() : await locks.request(REFRESH_LOCK, run);
  };

  const refreshOnce = (): Promise<boolean> => {
    inflight ??= runRefresh().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return async (input, init) => {
    const sentAt = epoch;
    const make = await replayable(input);
    const response = await inner(make(), init);
    if (response.status !== 401) return response;
    if (pathOf(input).startsWith("/api/v1/auth/")) return response;
    if ((await errorCode(response)) !== "UNAUTHENTICATED") return response;

    const refreshed = epoch > sentAt ? true : await refreshOnce();
    if (!refreshed) {
      opts.onSessionEnded();
      return response;
    }
    return inner(make(), init);
  };
}
