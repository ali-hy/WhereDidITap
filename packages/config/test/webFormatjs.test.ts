// F-1 rule 4's formatjs rules on web files (A-12, A-13, A-18). TP-11.21.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { errorRuleIds, lintFixture } from "./support/lintFixture.js";

const PRELUDE = `interface Descriptor {
  id?: string;
  defaultMessage?: string;
}
declare function t(descriptor: Descriptor): string;
declare const m: Descriptor;
`;

describe("TP-11.21: formatjs on apps/web/src (F-1, A-12, A-13, A-18)", () => {
  it("TP-11.21: the run uses eslint 10.12.0 and completes without a thrown error; <p>Hello</p> is an error and <p>{t(m)}</p> is ok", async () => {
    const files = {
      "apps/web/src/literal.tsx": `${PRELUDE}export const view = <p>Hello</p>;\n`,
      "apps/web/src/translated.tsx": `${PRELUDE}export const view = <p>{t(m)}</p>;\n`,
    };

    const messages = await lintFixture(files);

    expect(ESLint.version).toBe("10.12.0");
    expect(errorRuleIds(messages, "apps/web/src/literal.tsx")).toContain(
      "formatjs/no-literal-string-in-jsx",
    );
    expect(errorRuleIds(messages, "apps/web/src/translated.tsx")).toEqual([]);
  });

  it('TP-11.21 (A-12): enforce-default-message reports t({ id: "a.b" }) without defaultMessage (additionalFunctionNames)', async () => {
    const file = "apps/web/src/noDefault.tsx";

    const messages = await lintFixture({
      [file]: `${PRELUDE}export const x = t({ id: "a.b" });\n`,
    });

    expect(errorRuleIds(messages, file)).toContain("formatjs/enforce-default-message");
  });

  it.each([
    ["a plural without other", '"{count, plural, one {x}"'],
    ["an unclosed argument", '"Hello {name"'],
  ])("TP-11.21 (A-18): no-invalid-icu reports %s", async (_label, message) => {
    const file = "apps/web/src/badIcu.tsx";

    const messages = await lintFixture({
      [file]: `${PRELUDE}export const x = t({ id: "a.b", defaultMessage: ${message} });\n`,
    });

    expect(errorRuleIds(messages, file)).toContain("formatjs/no-invalid-icu");
  });

  it("TP-11.21 (A-18): no-invalid-icu accepts a valid plural", async () => {
    const file = "apps/web/src/goodIcu.tsx";

    const messages = await lintFixture({
      [file]: `${PRELUDE}export const x = t({ id: "a.d", defaultMessage: "{count, plural, one {# item} other {# items}}" });\n`,
    });

    expect(errorRuleIds(messages, file)).not.toContain("formatjs/no-invalid-icu");
  });
});
