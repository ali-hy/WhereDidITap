// F-306 canonicalJson. TP-1.9, plus the extra cases TP-1.22x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/json/canonical.js";

class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

describe("F-306 canonicalJson", () => {
  it("TP-1.9: keys are sorted at every depth, arrays keep order, undefined properties are omitted", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] }, u: undefined })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });

  it.each([
    ["1n", 1n],
    ["NaN", Number.NaN],
    ["new Date()", new Date(0)],
  ])("TP-1.9: %s throws TypeError", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it.each([
    ["[1, undefined]", [1, undefined]],
    ["{ a: [[undefined]] }", { a: [[undefined]] }],
    ["undefined", undefined],
  ])("TP-1.9 (A-38): %s throws TypeError", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it.each([
    ["[1, , 3]", [1, , 3]],
    ["{ a: [, 1] }", { a: [, 1] }],
  ])(
    "TP-1.22x: a sparse array (%s) throws TypeError, like an undefined element (A-38)",
    (_label, value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    },
  );

  it("TP-1.9 (A-38): a property set to undefined is dropped: { a: undefined } is {}", () => {
    expect(canonicalJson({ a: undefined })).toBe("{}");
  });

  it('TP-1.9 (A-45): an object containing itself throws TypeError("Circular structure")', () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;

    expect(() => canonicalJson(a)).toThrow(new TypeError("Circular structure"));
  });

  it('TP-1.9 (A-45): an array containing itself throws TypeError("Circular structure")', () => {
    const arr: unknown[] = [];
    arr.push(arr);

    expect(() => canonicalJson(arr)).toThrow(new TypeError("Circular structure"));
  });

  it("TP-1.9 (A-45): the same object reached by two non-cyclic paths is written twice", () => {
    const x = { v: 1 };

    expect(canonicalJson({ p: x, q: x })).toBe('{"p":{"v":1},"q":{"v":1}}');
  });

  function nestedArrays(depth: number): unknown {
    let value: unknown = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  }

  function nestedObjects(depth: number): unknown {
    let value: unknown = 1;
    for (let i = 0; i < depth; i += 1) value = { a: value };
    return value;
  }

  it("TP-1.9 (A-48): 100 nested arrays around 1 are written", () => {
    expect(canonicalJson(nestedArrays(100))).toBe(`${"[".repeat(100)}1${"]".repeat(100)}`);
  });

  it.each([
    ["101 nested arrays", () => nestedArrays(101)],
    ["10 000 nested objects", () => nestedObjects(10_000)],
  ])('TP-1.9 (A-48): %s throw TypeError("Structure too deep"), not RangeError', (_label, build) => {
    expect(() => canonicalJson(build())).toThrow(new TypeError("Structure too deep"));
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a Map", new Map([["a", 1]])],
    ["a Set", new Set([1])],
    ["a class instance", new Point(1, 2)],
    ["a bigint nested in an object", { a: { b: 1n } }],
    ["a Date nested in an array", [new Date(0)]],
  ])("TP-1.22x: %s throws TypeError", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it("TP-1.22x: keys are sorted by UTF-16 code unit, not by locale", () => {
    expect(canonicalJson({ b: 1, a: 2, B: 3, Z: 4, é: 5, "\u{1F600}": 6, Ａ: 7 })).toBe(
      '{"B":3,"Z":4,"a":2,"b":1,"é":5,"\u{1F600}":6,"Ａ":7}',
    );
  });

  it.each([
    ["null", null, "null"],
    ["a string with escapes", 'a"b\\c\n', '"a\\"b\\\\c\\n"'],
    ["true", true, "true"],
    ["an empty object", {}, "{}"],
    ["an empty array", [], "[]"],
    ["a nested empty structure", { a: [], b: {} }, '{"a":[],"b":{}}'],
    ["a negative decimal", -1.5, "-1.5"],
  ])("TP-1.22x: %s serialises like JSON without whitespace", (_label, value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });
});
