// The request context every procedure receives, and F-54's AuthHook.
import type { ApiContainer } from "../container.js";
import type { Logger } from "../observability/logger.js";
import type { CommitTracker } from "../db/types.js";

export interface Principal {
  readonly userId: string;
  readonly isOwner: boolean;
  /** A-1 (identity PA-1). */
  readonly sessionId: string;
}

export type ClientKind = "android" | "web" | "other";

export interface RequestContext {
  /** The trace id (32 hex) when a trace is active, else a UUIDv7 without dashes. */
  readonly requestId: string;
  readonly principal: Principal | null;
  readonly clientKind: ClientKind;
  readonly clientVersion: number | null;
  readonly ip: string;
  /** The HTTP method (A-165: only GET, HEAD and DELETE inputs are coerced). Set by the server. */
  readonly method?: string;
  /** Lower-cased names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** oRPC's ResponseHeadersPlugin merges these into the response. */
  readonly responseHeaders: Headers;
  readonly resHeaders: Headers;
  /** oRPC's RequestHeadersPlugin sets this. */
  readonly reqHeaders?: Headers;
  readonly commitTracker: CommitTracker;
  readonly logger: Logger;
  readonly container: ApiContainer;
  /** Set by the server when oRPC matches a procedure: its OpenAPI path, for F-38. */
  readonly matched: { route?: string };
}

export interface AuthHook {
  authenticate(req: {
    headers: Readonly<Record<string, string | undefined>>;
    cookies: Readonly<Record<string, string>>;
  }): Promise<Principal | null>;
}

export const noAuthHook: AuthHook = { authenticate: () => Promise.resolve(null) };
