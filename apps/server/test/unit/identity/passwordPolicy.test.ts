// F-38 checkPassword and loadCommonPasswords (identity LLD §4.1, LD-5). TP-0.5, TP-0.35's U part,
// plus extra cases TP-0.5x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { serverRoot } from "../../../src/platform/config/serverRoot.js";
import { checkPassword, loadCommonPasswords } from "../../../src/identity/passwordPolicy.js";

const COMMON: ReadonlySet<string> = new Set(["password1234"]);

describe("TP-0.5: checkPassword", () => {
  it.each([
    ["11 code points", "abcdefghijk", "mona@x.com", "too_short"],
    ["12 code points", "abcdefghijkl", "mona@x.com", null],
    ["129 code points", "a".repeat(129), "mona@x.com", "too_long"],
    ['"Password1234" (common, case-insensitive)', "Password1234", "mona@x.com", "common"],
    ['"xxmonaxxxxxx" for mona@x.com', "xxmonaxxxxxx", "mona@x.com", "contains_email"],
    ['"xxalxxxxxxxx" for al@x.com (local part under 4)', "xxalxxxxxxxx", "al@x.com", null],
    ['"é" as NFD ×12 (12 code points after NFC)', "é".repeat(12), "mona@x.com", null],
  ])("TP-0.5: %s → %s", (_label, password, email, expected) => {
    expect(checkPassword(password, email, COMMON)).toBe(expected);
  });
});

describe("TP-0.5x: checkPassword boundaries and order", () => {
  it("TP-0.5x: 128 code points is allowed (the upper bound)", () => {
    expect(checkPassword("a".repeat(128), "mona@x.com", COMMON)).toBeNull();
  });

  it("TP-0.5x: length counts code points, not UTF-16 units (12 emoji are 24 units)", () => {
    expect(checkPassword("\u{1F600}".repeat(12), "mona@x.com", COMMON)).toBeNull();
    expect(checkPassword("\u{1F600}".repeat(11), "mona@x.com", COMMON)).toBe("too_short");
  });

  it("TP-0.5x: an empty password is too_short", () => {
    expect(checkPassword("", "mona@x.com", COMMON)).toBe("too_short");
  });

  it("TP-0.5x: too_short wins over common and contains_email (rule order)", () => {
    expect(checkPassword("mona", "mona@x.com", new Set(["mona"]))).toBe("too_short");
  });

  it("TP-0.5x: common wins over contains_email (rule order)", () => {
    expect(checkPassword("monamonamona", "mona@x.com", new Set(["monamonamona"]))).toBe("common");
  });

  it("TP-0.5x: a local part of exactly 4 is checked, case-insensitively", () => {
    expect(checkPassword("xxMONAxxxxxx", "mona@x.com", COMMON)).toBe("contains_email");
  });
});

describe("TP-0.35 (U): the common-password list from the source tree", () => {
  const defaultPath = path.join(serverRoot(), "src", "identity", "assets", "common-100k.txt.gz");

  it("TP-0.35: the asset is at join(serverRoot(), 'src/identity/assets/common-100k.txt.gz')", () => {
    expect(existsSync(defaultPath)).toBe(true);
  });

  it('TP-0.35: loadCommonPasswords() reads the default path: more than 90 000 entries, including "password"', () => {
    const list = loadCommonPasswords();

    expect(list.size).toBeGreaterThan(90_000);
    expect(list.has("password")).toBe(true);
  });

  it("TP-0.35: a second call returns the same Set instance, and it is the default path's (memoised per path)", () => {
    const first = loadCommonPasswords();

    expect(loadCommonPasswords()).toBe(first);
    expect(loadCommonPasswords(defaultPath)).toBe(first);
  });
});

describe("TP-0.5x: loadCommonPasswords parsing", () => {
  it("TP-0.5x: lines are trimmed, lower-cased and NFC-normalised; empty lines are skipped", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-common-"));
    const file = path.join(dir, "list.txt.gz");
    writeFileSync(file, gzipSync(Buffer.from("  Hunter2  \r\n\n   \nRémy\nhunter2\n", "utf8")));

    const list = loadCommonPasswords(file);

    expect([...list].sort()).toEqual(["hunter2", "rémy"].sort());
  });
});
