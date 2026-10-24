// F-312: locale resolution and text direction.
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi", "dv"]);

function languageOf(locale: string): string {
  return (locale.split("-")[0] ?? "").toLowerCase();
}

/** A-465: pseudo-locales (second subtag XA or XB) are chosen only by an exact request. */
function isPseudoLocale(locale: string): boolean {
  const second = (locale.split("-")[1] ?? "").toUpperCase();
  return second === "XA" || second === "XB";
}

export function resolveLocale(
  requested: string | null,
  supported: readonly string[],
  fallback?: string,
): string {
  if (requested === null || requested === "") {
    return fallback ?? "en";
  }
  const wanted = requested.toLowerCase();
  const exact = supported.find((tag) => tag.toLowerCase() === wanted);
  if (exact !== undefined) {
    return exact;
  }
  const language = languageOf(wanted);
  const sameLanguage = supported.filter(
    (tag) => languageOf(tag) === language && !isPseudoLocale(tag),
  );
  const bare = sameLanguage.find((tag) => tag.toLowerCase() === language);
  return bare ?? sameLanguage[0] ?? fallback ?? "en";
}

export function directionOf(locale: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(languageOf(locale)) ? "rtl" : "ltr";
}
