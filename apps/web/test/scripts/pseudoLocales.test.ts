// F-207 the pseudo-locale generator. TP-11.24, plus extra cases TP-11.31x (A-310). IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TYPE, parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { toAccented, toRtlPseudo, writePseudoLocales } from "../../scripts/pseudoLocales.js";

const MESSAGE = "{count, plural, one {# item} other {# items}} for {name}";

/**
 * The ICU structure without literal text (literal nodes dropped, so added or merged literals
 * don't count): argument names, plural keys and node types.
 */
function shape(elements: readonly MessageFormatElement[]): unknown[] {
  return elements
    .filter((e) => e.type !== TYPE.literal)
    .map((e) => {
      if (e.type === TYPE.plural || e.type === TYPE.select) {
        return {
          type: e.type,
          value: e.value,
          options: Object.fromEntries(
            Object.entries(e.options).map(([key, option]) => [key, shape(option.value)]),
          ),
        };
      }
      if (e.type === TYPE.tag) return { type: e.type, value: e.value, children: shape(e.children) };
      return { type: e.type, value: "value" in e ? e.value : undefined };
    });
}

/** Every literal text segment, in order. */
function literals(elements: readonly MessageFormatElement[]): string[] {
  return elements.flatMap((e) => {
    if (e.type === TYPE.literal) return [e.value];
    if (e.type === TYPE.plural || e.type === TYPE.select) {
      return Object.values(e.options).flatMap((o) => literals(o.value));
    }
    if (e.type === TYPE.tag) return literals(e.children);
    return [];
  });
}

describe("TP-11.24: pseudo-locales keep ICU syntax and transform only literal text (F-207)", () => {
  it.each([
    ["toAccented", toAccented],
    ["toRtlPseudo", toRtlPseudo],
  ])("TP-11.24: %s's output parses as ICU with the same arguments and keywords", (_name, fn) => {
    const original = parse(MESSAGE);

    const transformed = parse(fn(MESSAGE));

    expect(shape(transformed)).toEqual(shape(original));
    expect(literals(transformed)).not.toEqual(literals(original));
  });

  it("TP-11.24: toAccented accents the letters of literal text and wraps the message in […]", () => {
    const out = toAccented(MESSAGE);

    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(literals(parse(out)).join("")).toMatch(/[áéíóúçñ]/);
    expect(out).toContain("{name}");
  });

  it("TP-11.24: toRtlPseudo wraps each literal segment in U+200F at both ends, keeping the letters", () => {
    const segments = literals(parse(toRtlPseudo(MESSAGE)));

    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.startsWith("‏")).toBe(true);
      expect(segment.endsWith("‏")).toBe(true);
    }
    expect(segments.join("")).toContain("item");
  });
});

describe("TP-11.31x: writePseudoLocales (A-310)", () => {
  it("TP-11.31x: writes en-XA.json and ar-XB.json with the en catalog's ids, transformed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-pseudo-"));
    try {
      const enCatalogPath = path.join(dir, "en.json");
      writeFileSync(enCatalogPath, JSON.stringify({ "a.b": "Hello {name}" }));
      const outDir = path.join(dir, "generated");

      writePseudoLocales({ enCatalogPath, outDir });

      const xa = JSON.parse(readFileSync(path.join(outDir, "en-XA.json"), "utf8")) as Record<
        string,
        string
      >;
      const xb = JSON.parse(readFileSync(path.join(outDir, "ar-XB.json"), "utf8")) as Record<
        string,
        string
      >;
      expect(Object.keys(xa)).toEqual(["a.b"]);
      expect(Object.keys(xb)).toEqual(["a.b"]);
      expect(xa["a.b"]).toBe(toAccented("Hello {name}"));
      expect(xb["a.b"]).toBe(toRtlPseudo("Hello {name}"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Review B-4: select, tags, apostrophes and quoted literals, and the padding rule.
describe("TP-11.24: more ICU syntax survives (F-207, review B-4)", () => {
  const SELECT_TAG = "{kind, select, card {Card} other {Other}} <b>bold</b>";

  it.each([
    ["toAccented", toAccented],
    ["toRtlPseudo", toRtlPseudo],
  ])(
    "TP-11.24: %s keeps a select and a tag: it parses, the shape is equal, and the tag's children are transformed",
    (_name, fn) => {
      const original = parse(SELECT_TAG);

      const transformed = parse(fn(SELECT_TAG));

      expect(shape(transformed)).toEqual(shape(original));
      const tagOf = (els: readonly MessageFormatElement[]) => {
        const tag = els.find((e) => e.type === TYPE.tag);
        if (tag?.type !== TYPE.tag) throw new Error("no tag");
        return tag;
      };
      expect(literals(tagOf(transformed).children)).not.toEqual(literals(tagOf(original).children));
      expect(literals(tagOf(transformed).children).join("")).not.toBe("bold");
    },
  );

  it.each([
    ["toAccented", toAccented],
    ["toRtlPseudo", toRtlPseudo],
  ] as const)("TP-11.24: %s keeps an apostrophe and a quoted literal", (_name, fn) => {
    const apostrophe = parse(fn("You don't"));
    expect(shape(apostrophe)).toEqual(shape(parse("You don't")));
    expect(literals(apostrophe).join("")).toContain("'");

    const quoted = parse(fn("Use '{braces}' here"));
    expect(shape(quoted)).toEqual(shape(parse("Use '{braces}' here")));
    // The quoted {braces} stays literal text, not an argument.
    expect(quoted.some((e) => e.type === TYPE.argument)).toBe(false);
    expect(literals(quoted).join("")).toMatch(/\{.*\}/);
  });

  it("TP-11.24: toAccented pads one ~ per 3 characters: abcdef is [áƀçðéƒ~~]", () => {
    expect(toAccented("abcdef")).toBe("[áƀçðéƒ~~]");
  });
});
