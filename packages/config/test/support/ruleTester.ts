// RuleTester for the `budmon/*` rules (F-2, F-3, F-3b), wired to Vitest. The rules are taken
// from F-1's configuration (the `budmon` plugin it registers), so the tests run the rule objects
// ESLint actually uses.
import { RuleTester, type Rule } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { createBudmonEslintConfig } from "../../eslint/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** The `budmon/<name>` rule from F-1's plugin. */
export function budmonRule(name: string): Rule.RuleModule {
  for (const config of createBudmonEslintConfig({ tsconfigRootDir: process.cwd() })) {
    const rule = config.plugins?.["budmon"]?.rules?.[name];
    if (rule !== undefined) return rule;
  }
  throw new Error(`F-1 registers no budmon/${name} rule`);
}

/** TSX source, ESM, latest syntax. */
export const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
    ecmaVersion: "latest",
    sourceType: "module",
  },
});
