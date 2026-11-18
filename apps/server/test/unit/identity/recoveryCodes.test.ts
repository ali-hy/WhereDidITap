// F-61 recovery codes (identity LLD §4.5). TP-4.4, plus extra cases ending in "x".
// TP-4.4's normalisation inputs ("7kq2 m9xd-4tra" → "7KQ2M9XD4TRA") contain a "9", which F-61's
// ^[A-Z2-7]{12}$ refuses; those exact inputs wait for the planner, and TP-4.4x covers the rule
// with base32 characters only.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  currentKeyHmac,
  formatRecoveryCode,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  recoveryCodeHmacs,
} from "../../../src/identity/recoveryCodes.js";

const FORMAT = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/;
const K1 = Buffer.alloc(32, 1);
const K2 = Buffer.alloc(32, 2);
const RING = {
  current: "k2",
  keys: new Map([
    ["k1", K1],
    ["k2", K2],
  ]),
};
const hmac = (key: Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** A deterministic byte stream (a linear congruential generator); each call takes the next n. */
function seededSource(seed: number, prefix: Buffer = Buffer.alloc(0)) {
  let state = seed >>> 0;
  let pending = Buffer.from(prefix);
  return (n: number): Buffer => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i += 1) {
      if (pending.length > 0) {
        out[i] = pending[0] ?? 0;
        pending = pending.subarray(1);
      } else {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        out[i] = state >>> 24;
      }
    }
    return out;
  };
}

describe("TP-4.4: generateRecoveryCodes", () => {
  it("TP-4.4: 10 codes from a seeded source → 10 distinct XXXX-XXXX-XXXX codes", () => {
    const codes = generateRecoveryCodes(10, seededSource(42));

    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(FORMAT);
    expect(new Set(codes).size).toBe(10);
  });

  it("TP-4.4x: the same seed gives the same codes (the source is the only randomness)", () => {
    expect(generateRecoveryCodes(10, seededSource(7))).toEqual(
      generateRecoveryCodes(10, seededSource(7)),
    );
  });

  it("TP-4.4x: a source whose first two 8-byte draws are equal still gives 10 distinct codes", () => {
    const twice = Buffer.concat([Buffer.alloc(8, 0xab), Buffer.alloc(8, 0xab)]);

    const codes = generateRecoveryCodes(10, seededSource(3, twice));

    expect(new Set(codes).size).toBe(10);
  });

  it("TP-4.4x: without a source, 10 distinct codes in the format", () => {
    const codes = generateRecoveryCodes(10);

    for (const code of codes) expect(code).toMatch(FORMAT);
    expect(new Set(codes).size).toBe(10);
  });

  it("TP-4.4x: each generated code normalises to its 12 characters", () => {
    for (const code of generateRecoveryCodes(10, seededSource(9))) {
      expect(normaliseRecoveryCode(code)).toBe(code.replaceAll("-", ""));
    }
  });
});

describe("TP-4.4x: formatRecoveryCode and normaliseRecoveryCode", () => {
  it('TP-4.4x: formatRecoveryCode("7KQ2M3XD4TRA") is "7KQ2-M3XD-4TRA"', () => {
    expect(formatRecoveryCode("7KQ2M3XD4TRA")).toBe("7KQ2-M3XD-4TRA");
  });

  it.each([
    ["7kq2 m3xd-4tra", "7KQ2M3XD4TRA"],
    ["7KQ2-M3XD-4TRA", "7KQ2M3XD4TRA"],
    ["  7kq2m3xd4tra ", "7KQ2M3XD4TRA"],
    ["7KQ2\tM3XD\n4TRA", "7KQ2M3XD4TRA"],
  ])("TP-4.4x: %j → %j (upper-cased, dashes and whitespace removed)", (input, expected) => {
    expect(normaliseRecoveryCode(input)).toBe(expected);
  });

  it.each([
    ["7KQ2M3XD4TRA2", "13 characters"],
    ["7KQ2M3XD4TR", "11 characters"],
    ["7KQ2M3XD4TR1", "a 1"],
    ["7KQ2M3XD4TR0", "a 0"],
    ["7KQ2M3XD4TR_", "an underscore"],
    ["", "empty"],
  ])("TP-4.4x: %j (%s) → null", (input) => {
    expect(normaliseRecoveryCode(input)).toBeNull();
  });
});

describe("TP-4.4: recoveryCodeHmacs and currentKeyHmac", () => {
  it("TP-4.4: with ring {k1, k2} → 2 entries, one HMAC-SHA-256 of the normalised code per key", () => {
    const entries: { keyId: string; hmac: Buffer }[] = recoveryCodeHmacs("7KQ2M3XD4TRA", RING);

    expect(entries).toHaveLength(2);
    const byKey = new Map(entries.map((e) => [e.keyId, Buffer.from(e.hmac)]));
    expect([...byKey.keys()].sort()).toEqual(["k1", "k2"]);
    expect(byKey.get("k1")?.equals(hmac(K1, "7KQ2M3XD4TRA"))).toBe(true);
    expect(byKey.get("k2")?.equals(hmac(K2, "7KQ2M3XD4TRA"))).toBe(true);
  });

  it("TP-4.4x: with ring {k1} → 1 entry", () => {
    const entries: { keyId: string }[] = recoveryCodeHmacs("7KQ2M3XD4TRA", {
      current: "k1",
      keys: new Map([["k1", K1]]),
    });

    expect(entries.map((e) => e.keyId)).toEqual(["k1"]);
  });

  it("TP-4.4x: currentKeyHmac uses the ring's current key", () => {
    const entry = currentKeyHmac("7KQ2M3XD4TRA", RING);

    expect(entry.keyId).toBe("k2");
    expect(Buffer.from(entry.hmac).equals(hmac(K2, "7KQ2M3XD4TRA"))).toBe(true);
  });
});
