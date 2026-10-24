// F-198 CANARIES and scanForCanaries (test tooling, delivered in S-3). TP-16.1, plus extra cases
// TP-3.18x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { CANARIES, scanForCanaries } from "../src/index.js";

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("TP-16.1: scanForCanaries", () => {
  it("TP-16.1: finds a canary raw, base64-encoded and URL-encoded, with the source and offset", () => {
    const raw = CANARIES.email;
    const encoded = base64(raw);
    const url = encodeURIComponent(raw);
    const text = `a ${raw} b ${encoded} c ${url} d`;

    const hits = scanForCanaries([{ name: "log", text }], CANARIES);

    expect(hits).toEqual([
      { source: "log", canary: "email", offset: text.indexOf(raw) },
      { source: "log", canary: "email", offset: text.indexOf(encoded) },
      { source: "log", canary: "email", offset: text.indexOf(url) },
    ]);
  });
});

// A-117 (code review B-3): a canary base64-encoded inside a payload at byte offsets 0, 1 and 2,
// in the standard and the URL-safe alphabets, is found: one hit for each of the 6 encodings.
describe("TP-16.1: base64 at every alignment, in both alphabets (A-117)", () => {
  function urlSafe(text: string): string {
    return text.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  }

  const ENCODINGS = [0, 1, 2].flatMap((offset) => [
    { offset, alphabet: "standard", encode: base64 },
    { offset, alphabet: "URL-safe", encode: (v: string) => urlSafe(base64(v)) },
  ]);

  it.each(Object.keys(CANARIES) as (keyof typeof CANARIES)[])(
    "TP-16.1: the %s canary is found in each of the 6 encodings",
    (canary) => {
      for (const { offset, alphabet, encode } of ENCODINGS) {
        const text = encode(`${"f".repeat(offset)}${CANARIES[canary]}"}`);

        expect(
          scanForCanaries([{ name: "b64", text }], CANARIES).map((h) => h.canary),
          `${alphabet}, offset ${String(offset)}`,
        ).toEqual([canary]);
      }
    },
  );

  // F-198's own canaries happen to encode without + or /, so the URL-safe alphabet is exercised
  // with a canary set whose value does.
  it("TP-16.1: a canary whose encoding holds + and / is found in both alphabets at every alignment", () => {
    const canaries = { ...CANARIES, payee: "?>?>?>~~~~~~ab" };

    for (const { offset, alphabet, encode } of ENCODINGS) {
      const text = encode(`${"f".repeat(offset)}${canaries.payee}"}`);
      if (alphabet === "standard") expect(text).toMatch(/[+/]/);
      else expect(text).toMatch(/[-_]/);

      expect(
        scanForCanaries([{ name: "b64", text }], canaries).map((h) => h.canary),
        `${alphabet}, offset ${String(offset)}`,
      ).toEqual(["payee"]);
    }
  });

  it.each([0, 1, 2, 3, 4, 5])(
    "TP-16.1: the payee canary %i bytes into a base64-encoded JSON payload is found",
    (fillerLength) => {
      const json = JSON.stringify({ [`k${"x".repeat(fillerLength)}`]: CANARIES.payee });

      for (const text of [base64(json), urlSafe(base64(json))]) {
        expect(scanForCanaries([{ name: "b64", text }], CANARIES).map((h) => h.canary)).toEqual([
          "payee",
        ]);
      }
    },
  );
});

describe("TP-3.18x: CANARIES and scanForCanaries, further cases", () => {
  it("TP-3.18x: the canaries are F-198's values", () => {
    expect(CANARIES).toEqual({
      amountMinor: "987654321",
      payee: "CANARYPAYEE7f3a",
      email: "canary.7f3a@example.invalid",
      token: "ya29.CANARYTOKEN7f3a",
      message: "CANARYMESSAGE7f3a",
    });
  });

  it("TP-3.18x: clean text has no hits", () => {
    expect(scanForCanaries([{ name: "a", text: "nothing to see 12345" }], CANARIES)).toEqual([]);
  });

  it("TP-3.18x: the search is case-sensitive", () => {
    const text = CANARIES.payee.toLowerCase();

    expect(scanForCanaries([{ name: "a", text }], CANARIES)).toEqual([]);
  });

  it("TP-3.18x: every canary is found, each hit naming its source", () => {
    const sources = [
      { name: "one", text: `x${CANARIES.amountMinor}` },
      { name: "two", text: `${CANARIES.token} ${CANARIES.message}` },
    ];

    const hits = scanForCanaries(sources, CANARIES);

    expect(hits).toEqual([
      { source: "one", canary: "amountMinor", offset: 1 },
      { source: "two", canary: "token", offset: 0 },
      { source: "two", canary: "message", offset: CANARIES.token.length + 1 },
    ]);
  });

  it("TP-3.18x: a canary whose URL-encoded form equals the raw value is reported once per occurrence", () => {
    const text = `${CANARIES.payee}|${CANARIES.payee}`;

    expect(scanForCanaries([{ name: "a", text }], CANARIES)).toEqual([
      { source: "a", canary: "payee", offset: 0 },
      { source: "a", canary: "payee", offset: CANARIES.payee.length + 1 },
    ]);
  });
});
