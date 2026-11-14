// F-122: outbound HTTP honours HTTPS_PROXY, HTTP_PROXY and NO_PROXY (undici), and connects
// directly when none is set. No code path checks whether a proxy is set (D-29 rule 3 (b)).
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function installProxySupport(env: Readonly<Record<string, string | undefined>>): {
  httpsProxy?: string;
} {
  const pick = (upper: string, lower: string): string | undefined => {
    const value = env[upper] ?? env[lower];
    return value === undefined || value === "" ? undefined : value;
  };
  const httpProxy = pick("HTTP_PROXY", "http_proxy");
  const httpsProxyUrl = pick("HTTPS_PROXY", "https_proxy");
  const noProxy = pick("NO_PROXY", "no_proxy");
  // Always installed: with no variable it connects directly.
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      ...(httpProxy === undefined ? {} : { httpProxy }),
      ...(httpsProxyUrl === undefined ? {} : { httpsProxy: httpsProxyUrl }),
      ...(noProxy === undefined ? {} : { noProxy }),
    }),
  );
  return httpsProxyUrl === undefined ? {} : { httpsProxy: httpsProxyUrl };
}
