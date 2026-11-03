// F-1 rule 3, money (A-15). TP-0.4, plus the extra cases TP-0.10x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorRuleIds, errorsIn, lintFixture } from "./support/lintFixture.js";

const SERVER_FILE = "apps/server/src/x/money.ts";
const REQUIRE_DESCRIPTION = /(^|\/)eslint-comments\/require-description$/;
const MONEY_RULES = ["no-restricted-globals", "no-restricted-properties", "no-restricted-syntax"];

const A = "declare const a: string;\n\n";
const PARSE_FLOAT = `${A}export const n = parseFloat(a);\n`;
const NUMBER_CALL = `${A}export const n = Number(a);\n`;
const BIGINT_NUMBER_MODE =
  'declare function bigint(config: { mode: string }): unknown;\n\nexport const c = bigint({ mode: "number" });\n';

describe("F-1 money", () => {
  describe("TP-0.4", () => {
    it.each([
      ["parseFloat(a)", "no-restricted-globals", PARSE_FLOAT],
      ["Number(a)", "no-restricted-syntax", NUMBER_CALL],
      ['bigint({ mode: "number" })', "no-restricted-syntax", BIGINT_NUMBER_MODE],
      [
        "Number.parseFloat(a)",
        "no-restricted-properties",
        `${A}export const n = Number.parseFloat(a);\n`,
      ],
      [
        "globalThis.parseFloat(a)",
        "no-restricted-properties",
        `${A}export const n = globalThis.parseFloat(a);\n`,
      ],
      [
        "window.parseFloat(a)",
        "no-restricted-properties",
        `${A}export const n = window.parseFloat(a);\n`,
      ],
      ["+a", "no-restricted-syntax", `${A}export const n = +a;\n`],
    ])("TP-0.4: %s is a %s error", async (_label, ruleId, source) => {
      const messages = await lintFixture({ [SERVER_FILE]: source });

      expect(errorRuleIds(messages, SERVER_FILE)).toContain(ruleId);
    });

    it("TP-0.4: parseFloat(a)'s message says to use the money helpers (A-27)", async () => {
      const messages = await lintFixture({ [SERVER_FILE]: PARSE_FLOAT });

      const texts = errorsIn(messages, SERVER_FILE)
        .filter((m) => m.ruleId === "no-restricted-globals")
        .map((m) => m.message);
      expect(texts.some((m) => m.includes("parseFloat is forbidden; use the money helpers"))).toBe(
        true,
      );
    });

    it.each([
      ["-a", "declare const a: number;\n\nexport const n = -a;\n"],
      ["Number.parseInt(a, 10)", `${A}export const n = Number.parseInt(a, 10);\n`],
    ])("TP-0.4: %s is not a money-rule error", async (_label, source) => {
      const messages = await lintFixture({ [SERVER_FILE]: source });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      for (const rule of MONEY_RULES) {
        expect(ruleIds).not.toContain(rule);
      }
    });

    it("TP-0.4: a disable comment with a described reason before Number() passes", async () => {
      const messages = await lintFixture({
        [SERVER_FILE]: `${A}// eslint-disable-next-line no-restricted-syntax -- reason\nexport const n = Number(a);\n`,
      });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      expect(ruleIds).not.toContain("no-restricted-syntax");
      expect(ruleIds.filter((id) => id !== null && REQUIRE_DESCRIPTION.test(id))).toEqual([]);
    });

    it("TP-0.4: the same disable comment without a reason is a require-description error", async () => {
      const messages = await lintFixture({
        [SERVER_FILE]: `${A}// eslint-disable-next-line no-restricted-syntax\nexport const n = Number(a);\n`,
      });

      const ruleIds = errorRuleIds(messages, SERVER_FILE);
      expect(ruleIds.filter((id) => id !== null && REQUIRE_DESCRIPTION.test(id))).toHaveLength(1);
    });
  });

  // TP-0.10x (added): F-1 rule 3 applies in all three source trees it names.
  describe("TP-0.10x: where the money rules apply", () => {
    it.each([["packages/shared/src/money.ts"], ["apps/web/src/money.ts"]])(
      "TP-0.10x: parseFloat, Number(), bigint number mode, Number.parseFloat and unary + are errors in %s",
      async (file) => {
        const at = (name: string): string => file.replace("money.ts", name);
        const messages = await lintFixture({
          [at("a.ts")]: PARSE_FLOAT,
          [at("b.ts")]: NUMBER_CALL,
          [at("c.ts")]: BIGINT_NUMBER_MODE,
          [at("d.ts")]: `${A}export const n = Number.parseFloat(a);\n`,
          [at("e.ts")]: `${A}export const n = +a;\n`,
        });

        expect(errorRuleIds(messages, at("a.ts"))).toContain("no-restricted-globals");
        expect(errorRuleIds(messages, at("b.ts"))).toContain("no-restricted-syntax");
        expect(errorRuleIds(messages, at("c.ts"))).toContain("no-restricted-syntax");
        expect(errorRuleIds(messages, at("d.ts"))).toContain("no-restricted-properties");
        expect(errorRuleIds(messages, at("e.ts"))).toContain("no-restricted-syntax");
      },
    );

    it('TP-0.10x: bigint({ mode: "bigint" }) is not a money-rule error', async () => {
      const messages = await lintFixture({
        [SERVER_FILE]:
          'declare function bigint(config: { mode: string }): unknown;\n\nexport const c = bigint({ mode: "bigint" });\n',
      });

      expect(errorRuleIds(messages, SERVER_FILE)).not.toContain("no-restricted-syntax");
    });
  });
});
