// TP-0.18: `.gitattributes` (§2.2.1, A-9).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const EXPECTED_RULES = [
  "* text=auto eol=lf",
  "*.sh text eol=lf",
  "*.bash text eol=lf",
  "*.bats text eol=lf",
  "gradlew text eol=lf",
  "infra/local/budmon-local text eol=lf",
  "*.bat text eol=crlf",
  "*.cmd text eol=crlf",
  "*.ps1 text eol=crlf",
  "*.png binary",
  "*.jpg binary",
  "*.jar binary",
  "*.keystore binary",
  "*.dump binary",
];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/** `git check-attr` output as path → attribute → value. */
function checkAttr(
  attributes: readonly string[],
  paths: readonly string[],
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const line of git("check-attr", ...attributes, "--", ...paths).split("\n")) {
    const match = /^(.*): ([^:]+): (.*)$/.exec(line);
    if (match === null) continue;
    const [, file = "", attribute = "", value = ""] = match;
    const forFile = result.get(file) ?? new Map<string, string>();
    forFile.set(attribute, value);
    result.set(file, forFile);
  }
  return result;
}

describe("TP-0.18: .gitattributes", () => {
  it("TP-0.18 (a): the non-comment, non-blank lines equal §2.2.1's, in order", () => {
    const lines = readFileSync(path.join(ROOT, ".gitattributes"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(lines).toEqual(EXPECTED_RULES);
  });

  describe("TP-0.18 (b): git check-attr", () => {
    const SHELL = [
      "x/y.sh",
      "x.bash",
      "t/x.bats",
      "apps/android/gradlew",
      "infra/local/budmon-local",
    ];
    const WINDOWS = ["x.ps1", "x.bat", "x.cmd"];
    const BINARY = ["i.png", "k.jar", "d.dump"];

    it("TP-0.18 (b): a.ts is text=auto with eol=lf", () => {
      const attrs = checkAttr(["text", "eol", "diff"], ["a.ts"]).get("a.ts");

      expect(attrs?.get("text")).toBe("auto");
      expect(attrs?.get("eol")).toBe("lf");
    });

    it.each(SHELL.map((p) => [p]))("TP-0.18 (b): %s is text with eol=lf", (file) => {
      const attrs = checkAttr(["text", "eol", "diff"], [file]).get(file);

      expect(attrs?.get("text")).toBe("set");
      expect(attrs?.get("eol")).toBe("lf");
    });

    it.each(WINDOWS.map((p) => [p]))("TP-0.18 (b): %s is text with eol=crlf", (file) => {
      const attrs = checkAttr(["text", "eol", "diff"], [file]).get(file);

      expect(attrs?.get("text")).toBe("set");
      expect(attrs?.get("eol")).toBe("crlf");
    });

    it.each(BINARY.map((p) => [p]))("TP-0.18 (b): %s is binary (text and diff unset)", (file) => {
      const attrs = checkAttr(["text", "eol", "diff"], [file]).get(file);

      expect(attrs?.get("text")).toBe("unset");
      expect(attrs?.get("diff")).toBe("unset");
    });
  });

  it("TP-0.18 (c): no file in the index has CRLF or mixed line endings", () => {
    const offending = git("ls-files", "--eol")
      .split("\n")
      .filter((line) => /^i\/(crlf|mixed)\s/.test(line));

    expect(offending).toEqual([]);
  });
});
