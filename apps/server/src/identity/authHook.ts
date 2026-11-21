// F-24: resolves a request's bearer token or access cookie to a principal. It never writes.
import type { AuthHook, Principal } from "../platform/http/context.js";
import { parseClientHeader } from "../platform/http/clientVersion.js";
import { readCookie } from "./cookies.js";
import type { IdentityDeps } from "./identityModule.js";
import * as sessionsRepo from "./sessionsRepo.js";
import { hashToken } from "./tokens.js";

const BEARER = /^Bearer (bma_[A-Za-z0-9_-]{43})$/;
const ACCESS_TOKEN = /^bma_[A-Za-z0-9_-]{43}$/;

/** Which transport carries the token, or null when there's no usable credential. */
function credentialOf(req: Parameters<AuthHook["authenticate"]>[0]): {
  token: string;
  delivery: "bearer" | "cookie";
} | null {
  const bearer = BEARER.exec(req.headers["authorization"] ?? "")?.[1];
  if (bearer !== undefined) return { token: bearer, delivery: "bearer" };
  const cookie = readCookie("access", req.cookies, req.headers["host"]);
  // A cookie without the web client header is refused (CSRF, HLD §7.1).
  if (
    cookie !== null &&
    ACCESS_TOKEN.test(cookie) &&
    parseClientHeader(req.headers["x-budmon-client"]).kind === "web"
  ) {
    return { token: cookie, delivery: "cookie" };
  }
  return null;
}

export function createAuthHook(deps: Pick<IdentityDeps, "database" | "clock">): AuthHook {
  return {
    async authenticate(req): Promise<Principal | null> {
      const credential = credentialOf(req);
      if (credential === null) return null;
      const session = await sessionsRepo.findAuthByAccessHash(
        deps.database.handle,
        hashToken(credential.token),
      );
      if (session === null) return null;
      const now = deps.clock.now().epochMilliseconds;
      const userOk =
        session.user.status === "active" ||
        (session.user.status === "pending_deletion" && session.user.deletionRequestedBy === "self");
      if (
        session.delivery !== credential.delivery ||
        session.revokedAt !== null ||
        session.accessExpiresAt.getTime() <= now ||
        session.idleExpiresAt.getTime() <= now ||
        !userOk
      ) {
        return null;
      }
      return {
        userId: session.userId,
        isOwner: session.user.isProductOwner,
        sessionId: session.id,
      };
    },
  };
}
