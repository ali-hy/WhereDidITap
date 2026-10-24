// F-121: the capture worker reaches only the hosts it needs (D-29 rule 3).
export const CAPTURE_EGRESS_HOSTS: ReadonlySet<string> = new Set([
  "oauth2.googleapis.com",
  "gmail.googleapis.com",
  "cloudkms.googleapis.com",
  "pubsub.googleapis.com",
]);

export class EgressDeniedError extends Error {
  constructor(readonly host: string) {
    super(`egress denied: ${host}`);
    this.name = "EgressDeniedError";
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

export function createGuardedFetch(
  allowed: ReadonlySet<string>,
  inner: typeof fetch,
): typeof fetch {
  return (input, init) => {
    let url: URL;
    try {
      url = urlOf(input);
    } catch {
      return Promise.reject(new EgressDeniedError(""));
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      !allowed.has(url.hostname)
    ) {
      return Promise.reject(new EgressDeniedError(url.hostname));
    }
    return inner(input, { ...init, redirect: "manual" });
  };
}
