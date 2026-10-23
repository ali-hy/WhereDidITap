// F-193: values the rehearsal learns at run time (tokens, the owner's address and password) and the
// scanner that looks for them, plus the rehearsal's fixed names and ports (A-24, A-25, A-443,
// A-445). A hit carries the needle's name, never its value.

export const REHEARSAL_OWNER_EMAIL = "rehearsal-owner.7f3a@example.invalid";
export const REHEARSAL_SIGNIN_CLIENT_ID = "rehearsal-signin.apps.googleusercontent.com";
/** A-445: the date fake FX fails for in the canary flows; never in upgrade fixtures. */
export const REHEARSAL_FX_FAIL_DATE = "2024-03-05";
/** A-443: TLS listeners bind 0.0.0.0, controls 127.0.0.1. */
export const REHEARSAL_PORTS = {
  googleTls: 443,
  googleControl: 18081,
  fxTls: 8444,
  fxControl: 18082,
  sentryTls: 8445,
} as const;
export const REHEARSAL_HOSTS = {
  fx: "fx.rehearsal.invalid",
  sentry: "sentry.rehearsal.invalid",
} as const;

export interface Needle {
  name: string;
  value: string;
}

export interface NeedleHit {
  source: string;
  needle: string;
  offset: number;
}

/**
 * F-198's forms: the raw value, its encodeURIComponent form and its base64 forms. Inside a longer
 * base64 payload the value can start at any byte offset, so for each alignment k in {0, 1, 2} the
 * stable core of base64(k filler bytes + value) is searched, in the standard and URL-safe alphabets.
 */
function forms(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  const cores = [0, 1, 2].map((pad) => {
    const encoded = Buffer.concat([Buffer.alloc(pad), bytes]).toString("base64");
    const start = [0, 2, 3][pad] ?? 0;
    const end = Math.floor((bytes.length + pad) / 3) * 4;
    return encoded.slice(start, end);
  });
  const urlSafe = cores.map((core) => core.replaceAll("+", "-").replaceAll("/", "_"));
  return [...new Set([value, encodeURIComponent(value), ...cores, ...urlSafe])].filter(
    (form) => form.length >= 4,
  );
}

/** One hit per occurrence (an offset matched by several forms counts once), by source then offset. */
export function scanForNeedles(
  sources: readonly { name: string; text: string }[],
  needles: readonly Needle[],
): NeedleHit[] {
  for (const needle of needles) {
    if (needle.value.length < 8) {
      throw new TypeError(`needle ${needle.name} is shorter than 8 characters`);
    }
  }
  const prepared = needles.map((needle) => ({ name: needle.name, forms: forms(needle.value) }));
  const hits: NeedleHit[] = [];
  for (const source of sources) {
    const found: NeedleHit[] = [];
    for (const needle of prepared) {
      const offsets = new Set<number>();
      for (const form of needle.forms) {
        for (
          let at = source.text.indexOf(form);
          at !== -1;
          at = source.text.indexOf(form, at + 1)
        ) {
          offsets.add(at);
        }
      }
      for (const offset of offsets)
        found.push({ source: source.name, needle: needle.name, offset });
    }
    found.sort((a, b) => a.offset - b.offset);
    hits.push(...found);
  }
  return hits;
}
