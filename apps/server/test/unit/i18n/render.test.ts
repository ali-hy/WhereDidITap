// F-160 createMessageRenderer (A-126). TP-4.20, plus extra cases TP-4.40x. The tests build their own
// catalogues; the shipped en.json isn't touched.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { createMessageRenderer } from "../../../src/i18n/render.js";

const render = createMessageRenderer({ en: { "test.hello": "Hello {name}" } });

describe("TP-4.20: createMessageRenderer", () => {
  it("TP-4.20: en, test.hello with name Ali isolates the value", () => {
    expect(render("en", "test.hello", { name: "Ali" })).toBe("Hello ⁨Ali⁩");
  });

  it("TP-4.20: ar-EG (no ar catalogue) falls back to en", () => {
    expect(render("ar-EG", "test.hello", { name: "Ali" })).toBe("Hello ⁨Ali⁩");
  });

  it("TP-4.20: an unknown id throws Error('unknown message id')", () => {
    expect(() => render("en", "test.nope")).toThrow(new Error("unknown message id"));
  });

  it('TP-4.20 (A-319): a select message with kind "card" renders "Card", not "Other"', () => {
    const r = createMessageRenderer({
      en: { "test.kind": "{kind, select, card {Card} other {Other}}" },
    });

    expect(r("en", "test.kind", { kind: "card" })).toBe("Card");
  });

  it("TP-4.20: catalogues without en throw TypeError", () => {
    expect(() => createMessageRenderer({ ar: {} })).toThrow(TypeError);
  });
});

describe("TP-4.40x: createMessageRenderer, further cases (F-160)", () => {
  it("TP-4.40x: a locale with its own catalogue uses it", () => {
    const r = createMessageRenderer({
      en: { "test.hello": "Hello {name}" },
      ar: { "test.hello": "مرحبا {name}" },
    });

    expect(r("ar-EG", "test.hello", { name: "Ali" })).toBe("مرحبا ⁨Ali⁩");
  });

  it("TP-4.40x: an id present only in en falls back to en for another locale", () => {
    const r = createMessageRenderer({
      en: { "test.hello": "Hello {name}", "test.bye": "Bye" },
      ar: { "test.hello": "مرحبا {name}" },
    });

    expect(r("ar", "test.bye")).toBe("Bye");
  });

  it("TP-4.40x: an id missing from en throws even if another locale has it", () => {
    const r = createMessageRenderer({ en: {}, ar: { "test.only": "x" } });

    expect(() => r("ar", "test.only")).toThrow(new Error("unknown message id"));
  });

  it("TP-4.40x: a number value isn't isolated", () => {
    expect(render("en", "test.hello", { name: 7 })).toBe("Hello 7");
  });
});
