// F-3: email addresses. The same rule as the `users_email_format` check.

/** NFC, trimmed and lower-cased. */
export function normaliseEmail(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

const FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// C0 controls and DEL.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Takes a normalised address. */
export function isValidEmail(normalised: string): boolean {
  return (
    normalised.length >= 3 &&
    normalised.length <= 254 &&
    FORMAT.test(normalised) &&
    !CONTROL.test(normalised)
  );
}

/** The text before the last `@`. */
export function localPart(normalised: string): string {
  const at = normalised.lastIndexOf("@");
  return at < 0 ? normalised : normalised.slice(0, at);
}
