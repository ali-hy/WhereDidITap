// F-201: the oRPC client for the platform contract (and the modules' keys as they're added).
import { contract } from "@budmon/contract";
import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

/** A-327: every request times out after 15 s. */
const REQUEST_TIMEOUT_MS = 15_000;

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A W3C traceparent with a new random trace and span id, sampled. */
export function newTraceparent(): string {
  return `00-${hex(16)}-${hex(8)}-01`;
}

/** Carries a failed response's X-Request-Id from the client interceptor to the outer one. */
const REQUEST_ID_HOLDER = Symbol("budmon.requestId");
interface RequestIdHolder {
  requestId?: string;
}

export type ApiClient = ContractRouterClient<typeof contract>;

export function createApiClient(opts: {
  buildNumber: number;
  baseUrl?: string;
  fetch?: typeof fetch;
  onClientUpdateRequired?: () => void;
}): ApiClient {
  const link = new OpenAPILink(contract, {
    url: opts.baseUrl ?? `${location.origin}/api/v1`,
    headers: () => ({
      "X-Budmon-Client": `web/${String(opts.buildNumber)}`,
      traceparent: newTraceparent(),
    }),
    fetch: (request, init) =>
      (opts.fetch ?? globalThis.fetch)(request, {
        ...init,
        credentials: "same-origin",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      }),
    interceptors: [
      async (options) => {
        const holder: RequestIdHolder = {};
        try {
          return await options.next({
            ...options,
            context: { ...options.context, [REQUEST_ID_HOLDER]: holder },
          });
        } catch (error) {
          if (error instanceof ORPCError && error.code === "CLIENT_UPDATE_REQUIRED") {
            opts.onClientUpdateRequired?.();
          }
          // A-398: the failed call's X-Request-Id, for the error fallback's Reference.
          if (holder.requestId !== undefined && typeof error === "object" && error !== null) {
            Object.defineProperty(error, "requestId", {
              value: holder.requestId,
              enumerable: false,
              configurable: true,
            });
          }
          throw error;
        }
      },
    ],
    clientInterceptors: [
      async (options) => {
        const response = await options.next();
        if (response.status >= 400) {
          const holder = (options.context as Record<symbol, RequestIdHolder | undefined>)[
            REQUEST_ID_HOLDER
          ];
          const header = response.headers["x-request-id"];
          if (holder !== undefined && typeof header === "string") holder.requestId = header;
        }
        return response;
      },
    ],
  });
  return createORPCClient(link);
}
