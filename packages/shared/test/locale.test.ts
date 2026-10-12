// F-312 locales and bidi. TP-1.13, plus the extra cases TP-1.25x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { isolate } from "../src/i18n/bidi.js";
import { directionOf, resolveLocale } from "../src/i18n/locale.js";

describe("F-312 resolveLocale", () => {
  it('TP-1.13: "ar-EG" against ["en", "ar"] resolves to the language subtag "ar"', () => {
    expect(resolveLocale("ar-EG", ["en", "ar"])).toBe("ar");
  });

  it('TP-1.13: "fr" against ["en"] falls back to "en"', () => {
    expect(resolveLocale("fr", ["en"])).toBe("en");
  });

  it.each([
    ["en", ["en-US"], undefined, "en-US"],
    ["en-GB", ["en-US", "en"], undefined, "en"],
    ["pt", ["pt-BR", "pt-PT"], undefined, "pt-BR"],
    ["EN-us", ["en-US"], undefined, "en-US"],
    [null, ["en"], "ar", "ar"],
    ["", ["en-US"], "ar", "ar"],
  ])(
    "TP-1.13 (A-39): resolveLocale(%j, %j, %j) is %j",
    (requested, supported, fallback, expected) => {
      expect(resolveLocale(requested, supported, fallback)).toBe(expected);
    },
  );

  it("TP-1.25x: an exact match wins over the language subtag, case-insensitively, in the supported spelling", () => {
    expect(resolveLocale("EN-us", ["en", "en-US"])).toBe("en-US");
  });

  it("TP-1.25x: null resolves to the fallback, which defaults to en", () => {
    expect(resolveLocale(null, ["en", "ar"])).toBe("en");
    expect(resolveLocale(null, ["en", "ar"], "ar")).toBe("ar");
  });

  it("TP-1.25x: a given fallback is used when nothing matches", () => {
    expect(resolveLocale("fr-FR", ["en", "ar"], "ar")).toBe("ar");
  });
});

describe("F-312 directionOf", () => {
  it.each([
    ["ar-XB", "rtl"],
    ["he", "rtl"],
    ["en", "ltr"],
  ])("TP-1.13: directionOf(%j) is %s", (locale, direction) => {
    expect(directionOf(locale)).toBe(direction);
  });

  it.each([
    ["en-XA", "ltr"],
    ["AR-eg", "rtl"],
  ])("TP-1.13 (A-40): directionOf(%j) is %s", (locale, direction) => {
    expect(directionOf(locale)).toBe(direction);
  });

  it.each([["ar"], ["ar-EG"], ["fa-IR"], ["ur"], ["ps"], ["sd"], ["yi"], ["dv"], ["he-IL"]])(
    "TP-1.25x: directionOf(%j) is rtl",
    (locale) => {
      expect(directionOf(locale)).toBe("rtl");
    },
  );

  it.each([["en-US"], ["de-DE"], ["fr"], ["tr"]])("TP-1.25x: directionOf(%j) is ltr", (locale) => {
    expect(directionOf(locale)).toBe("ltr");
  });
});

describe("F-312 isolate", () => {
  it("TP-1.13: isolate wraps the text in FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE", () => {
    expect(isolate("x")).toBe("⁨x⁩");
  });
});

// A-319: packages/shared/src/i18n/isolateArgs.ts isn't written yet, so it loads through a variable
// specifier until it lands.
const ISOLATE_ARGS = "../src/i18n/isolateArgs.js";
type IsolateSimpleArguments = (
  message: string,
  values: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

async function isolateSimpleArguments(): Promise<IsolateSimpleArguments> {
  return (
    (await import(/* @vite-ignore */ ISOLATE_ARGS)) as {
      isolateSimpleArguments: IsolateSimpleArguments;
    }
  ).isolateSimpleArguments;
}

describe("F-312 isolateSimpleArguments (A-319)", () => {
  it.each([
    ["{name} paid", { name: "Ali" }, { name: "⁨Ali⁩" }],
    ["{kind, select, card {Card} other {Other}}", { kind: "card" }, { kind: "card" }],
    [
      "{n, plural, one {# item} other {# items}} for {who}",
      { n: 2, who: "Ali" },
      { n: 2, who: "⁨Ali⁩" },
    ],
    ["{kind} {kind, select, a {A} other {O}}", { kind: "a" }, { kind: "a" }],
    ["{", { x: "y" }, { x: "y" }],
  ])("TP-1.13 (A-319): isolateSimpleArguments(%j, %j) is %j", async (message, values, expected) => {
    const isolateArgs = await isolateSimpleArguments();

    expect(isolateArgs(message, values)).toEqual(expected);
  });
});
