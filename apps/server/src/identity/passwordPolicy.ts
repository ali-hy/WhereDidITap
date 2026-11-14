// F-38: the password policy and the common-password list (LD-5).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { serverRoot } from "../platform/config/serverRoot.js";
import { localPart } from "./emailAddress.js";

export type PasswordProblem = "too_short" | "too_long" | "common" | "contains_email";

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;
const MIN_LOCAL_PART = 4;

/** The first problem found, in the order short, long, common, contains the email's local part. */
export function checkPassword(
  password: string,
  email: string,
  common: ReadonlySet<string>,
): PasswordProblem | null {
  const p = password.normalize("NFC");
  const n = Array.from(p).length;
  if (n < MIN_LENGTH) return "too_short";
  if (n > MAX_LENGTH) return "too_long";
  const lower = p.toLowerCase();
  if (common.has(lower)) return "common";
  const local = localPart(email);
  if (local.length >= MIN_LOCAL_PART && lower.includes(local)) return "contains_email";
  return null;
}

const loaded = new Map<string, ReadonlySet<string>>();

/** Loads the gzipped list once per path. Entries are trimmed, lower-cased and NFC. */
export function loadCommonPasswords(
  gzPath: string = join(serverRoot(), "src", "identity", "assets", "common-100k.txt.gz"),
): ReadonlySet<string> {
  const cached = loaded.get(gzPath);
  if (cached !== undefined) return cached;
  const entries = new Set<string>();
  for (const line of gunzipSync(readFileSync(gzPath)).toString("utf8").split("\n")) {
    const entry = line.trim().normalize("NFC").toLowerCase();
    if (entry !== "") entries.add(entry);
  }
  loaded.set(gzPath, entries);
  return entries;
}
