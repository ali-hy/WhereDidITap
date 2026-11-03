// F-204: the query client and its retry rules.
import { QueryClient } from "@tanstack/solid-query";
import { toAppError } from "./errors.js";

const MAX_RETRIES = 3;

/** Retried while under 3 attempts for network, timeout, or a defined error with status ≥ 500. */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const e = toAppError(err);
  return e.kind === "network" || e.kind === "timeout" || (e.kind === "defined" && e.status >= 500);
}

const retryDelay = (attempt: number): number => 1000 * 2 ** attempt;

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      },
      mutations: { retry: 0 },
    },
  });
  // Mutations retry only with `meta.idempotent === true` (F-205's creates). TanStack's `retry`
  // can't see the mutation's meta, so the rule is applied where the client resolves options.
  const resolve = client.defaultMutationOptions.bind(client);
  client.defaultMutationOptions = (options) => {
    const resolved = resolve(options);
    if (options?.retry !== undefined) return resolved;
    return {
      ...resolved,
      retry: resolved.meta?.["idempotent"] === true ? shouldRetry : 0,
      retryDelay,
    };
  };
  return client;
}
