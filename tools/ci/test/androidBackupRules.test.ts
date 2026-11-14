// F-262 backup and device-transfer rules: the database, preferences and DataStore files never
// leave the phone. TP-13.11, a static check of the XML (A-350; it needs no Android SDK).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const XML = path.join(ROOT, "apps/android/app/src/main/res/xml");

interface Rule {
  kind: "include" | "exclude";
  domain: string;
  path: string;
}

/** The <include>/<exclude> elements inside `section` (or the whole file when no section is given). */
function rules(xml: string, section?: string): Rule[] {
  const body =
    section === undefined
      ? xml
      : (new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? "");
  return [...body.matchAll(/<(include|exclude)\b([^>]*)\/?>/g)].map((m) => {
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[2] ?? "")?.[1] ?? "";
    return { kind: m[1] as Rule["kind"], domain: attr("domain"), path: attr("path") };
  });
}

/** A-352's six excludes, the same in every section. */
const SIX = [
  "database budmon.db",
  "database budmon.db-journal",
  "database budmon.db-shm",
  "database budmon.db-wal",
  "file datastore/",
  "sharedpref .",
];

const summary = (list: Rule[]) => ({
  includes: list.filter((r) => r.kind === "include").length,
  excludes: list
    .filter((r) => r.kind === "exclude")
    .map((r) => `${r.domain} ${r.path}`)
    .sort(),
});

describe("TP-13.11: backup exclusion (F-262, A-350, A-352)", () => {
  it.each([["cloud-backup"], ["device-transfer"]])(
    "TP-13.11: data_extraction_rules.xml's <%s> has exactly the six excludes and no include",
    (section) => {
      const file = path.join(XML, "data_extraction_rules.xml");
      expect(existsSync(file)).toBe(true);

      expect(summary(rules(readFileSync(file, "utf8"), section))).toEqual({
        includes: 0,
        excludes: SIX,
      });
    },
  );

  it("TP-13.11: backup_rules.xml's <full-backup-content> has exactly the six excludes and no include", () => {
    const file = path.join(XML, "backup_rules.xml");
    expect(existsSync(file)).toBe(true);

    expect(summary(rules(readFileSync(file, "utf8"), "full-backup-content"))).toEqual({
      includes: 0,
      excludes: SIX,
    });
  });
});
