// F-119 PKCE, state and the authorisation URL; F-120 the authorisation-code exchange
// (worker-capture only, through F-121's guarded fetch).
import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import type { Clock, Temporal } from "@budmon/shared";
import { Secret } from "../observability/redaction.js";
import { randomToken } from "../security/hashing.js";

export function createPkcePair(randomBytes: (n: number) => Buffer = cryptoRandomBytes): {
  verifier: Secret<string>;
  challenge: string;
  method: "S256";
} {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier: Secret.of(verifier), challenge, method: "S256" };
}

export function createOAuthState(): string {
  return randomToken(32);
}

export function buildGoogleAuthorizationUrl(p: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  challenge: string;
  loginHint?: never;
}): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params: [string, string][] = [
    ["response_type", "code"],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["scope", p.scopes.join(" ")],
    ["state", p.state],
    ["code_challenge", p.challenge],
    ["code_challenge_method", "S256"],
    ["access_type", "offline"],
    ["prompt", "consent"],
    ["include_granted_scopes", "true"],
  ];
  for (const [name, value] of params) url.searchParams.set(name, value);
  return url;
}

export interface OAuthTokens {
  refreshToken: Secret<string>;
  accessToken: Secret<string>;
  expiresAt: Temporal.Instant;
  scopes: readonly string[];
}

export type OAuthExchangeReason =
  "invalid_grant" | "rejected" | "no_refresh_token" | "server" | "network";

/** The message is only the reason; response bodies are never kept. */
export class OAuthExchangeError extends Error {
  readonly retryable: boolean;
  constructor(readonly reason: OAuthExchangeReason) {
    super(reason);
    this.name = "OAuthExchangeError";
    this.retryable = reason === "server" || reason === "network";
  }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_EXPIRES_IN_SECONDS = 86_400 * 366;

export async function exchangeAuthorizationCode(
  deps: { fetch: typeof fetch; clientId: string; clientSecret: Secret<string>; clock: Clock },
  input: { code: Secret<string>; verifier: Secret<string>; redirectUri: string },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code.reveal(),
    code_verifier: input.verifier.reveal(),
    client_id: deps.clientId,
    client_secret: deps.clientSecret.reveal(),
    redirect_uri: input.redirectUri,
  }).toString();
  let response: Response;
  try {
    response = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
  } catch {
    throw new OAuthExchangeError("network");
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const fields = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (response.status === 200) {
    const refresh = fields["refresh_token"];
    const access = fields["access_token"];
    const expiresIn = fields["expires_in"];
    // A-259: a malformed 200 is a refusal, not retryable.
    if (
      typeof access !== "string" ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      // A-262: at most a year (366 days), checked before Temporal arithmetic.
      expiresIn > MAX_EXPIRES_IN_SECONDS
    ) {
      throw new OAuthExchangeError("rejected");
    }
    if (typeof refresh !== "string" || refresh === "") {
      throw new OAuthExchangeError("no_refresh_token");
    }
    const scope = fields["scope"];
    return {
      refreshToken: Secret.of(refresh),
      accessToken: Secret.of(access),
      expiresAt: deps.clock.now().add({ seconds: Math.trunc(expiresIn) }),
      scopes: typeof scope === "string" ? scope.split(" ").filter((s) => s !== "") : [],
    };
  }
  if (response.status >= 500 || response.status === 429) throw new OAuthExchangeError("server");
  if (response.status === 400 && fields["error"] === "invalid_grant") {
    throw new OAuthExchangeError("invalid_grant");
  }
  // Any other status (another 4xx, or a redirect, which is never followed) is a refusal.
  throw new OAuthExchangeError("rejected");
}
