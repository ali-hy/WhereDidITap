// F-130 provider decimal parsing. TP-9.1, plus extra cases TP-9.24x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import {
  JsonNumber,
  normaliseRate,
  parseJsonKeepingNumberText,
} from "../../../src/platform/fx/decimal.js";

describe("TP-9.1: lossless parsing and normalisation (F-130)", () => {
  it("TP-9.1 (A-281): numbers become JsonNumber of their exact source text; a JSON string stays a plain string", () => {
    const parsed = parseJsonKeepingNumberText(
      '{"rates":{"EGP":48.123456789012345,"X":1e-3,"S":"0.92"}}',
    ) as { rates: Record<string, unknown> };

    expect(parsed.rates["EGP"]).toBeInstanceOf(JsonNumber);
    expect(parsed.rates["EGP"]).toEqual(new JsonNumber("48.123456789012345"));
    expect(parsed.rates["X"]).toBeInstanceOf(JsonNumber);
    expect(parsed.rates["X"]).toEqual(new JsonNumber("1e-3"));
    expect(parsed.rates["S"]).toBe("0.92");
  });

  it('TP-9.1: normaliseRate("48.123456789012345") is "48.123456789012" (12 decimal places)', () => {
    expect(normaliseRate("48.123456789012345")).toBe("48.123456789012");
  });

  it.each([["0"], ["-1"], ["1e12"], ["abc"], ["0.0000000000004"]])(
    "TP-9.1: normaliseRate(%j) is null",
    (raw) => {
      expect(normaliseRate(raw)).toBeNull();
    },
  );

  // S-9 review B-1: a positive rate that rounds to zero at 12 places is refused, not stored as 0.
  it.each([["0.0000000000001"], ["4e-13"]])(
    "TP-9.1 (B-1): normaliseRate(%j), below 5e-13, is null",
    (raw) => {
      expect(normaliseRate(raw)).toBeNull();
    },
  );

  it('TP-9.1 (B-1): normaliseRate("1e-12") is "0.000000000001"', () => {
    expect(normaliseRate("1e-12")).toBe("0.000000000001");
  });

  it.each([["5e-13"], ["4.999999e-13"]])(
    "TP-9.24x (B-1): normaliseRate(%j) at the rounding edge is null (half-even rounds 5e-13 to 0)",
    (raw) => {
      expect(normaliseRate(raw)).toBeNull();
    },
  );

  it("TP-9.24x (A-281): strings, booleans and null are unchanged; numbers in arrays are JsonNumbers", () => {
    expect(parseJsonKeepingNumberText('{"a":"1.50","b":true,"c":[0.10,2],"d":null}')).toEqual({
      a: "1.50",
      b: true,
      c: [new JsonNumber("0.10"), new JsonNumber("2")],
      d: null,
    });
  });

  it.each([
    ["48.5", "48.500000000000"],
    ["0.000000000001", "0.000000000001"],
    ["999999999999.999999999999", "999999999999.999999999999"],
  ])("TP-9.24x: normaliseRate(%j) is %j", (raw, normalised) => {
    expect(normaliseRate(raw)).toBe(normalised);
  });
});
