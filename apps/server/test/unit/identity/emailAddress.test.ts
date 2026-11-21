// F-3 email addresses (identity LLD §4.1). TP-0.2, plus extra cases TP-0.2x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { isValidEmail, localPart, normaliseEmail } from "../../../src/identity/emailAddress.js";

/** `<local>@example.com` padded to exactly `length` characters. */
function addressOfLength(length: number): string {
  const domain = "@example.com";
  return "a".repeat(length - domain.length) + domain;
}

describe("TP-0.2: email addresses", () => {
  it('TP-0.2: normaliseEmail(" Mona@Example.COM ") is "mona@example.com"', () => {
    expect(normaliseEmail(" Mona@Example.COM ")).toBe("mona@example.com");
  });

  it('TP-0.2: "a@b" is invalid (no dot in the domain)', () => {
    expect(isValidEmail("a@b")).toBe(false);
  });

  it('TP-0.2: "a@b.co" is valid', () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("TP-0.2: a 255-character address is invalid", () => {
    const address = addressOfLength(255);
    expect(address).toHaveLength(255);

    expect(isValidEmail(address)).toBe(false);
  });

  it("TP-0.2: an address with \\u0007 is invalid", () => {
    expect(isValidEmail("mo\u0007na@example.com")).toBe(false);
  });
});

describe("TP-0.2x: email boundaries", () => {
  it("TP-0.2x: a 254-character address is valid (the upper bound)", () => {
    expect(isValidEmail(addressOfLength(254))).toBe(true);
  });

  it.each([
    ["two @", "a@b@c.co"],
    ["whitespace inside", "mo na@example.com"],
    ["no local part", "@example.com"],
    ["empty", ""],
    ["a DEL control character", "mona\u007f@example.com"],
  ])("TP-0.2x: %s is invalid", (_label, address) => {
    expect(isValidEmail(address)).toBe(false);
  });

  it("TP-0.2x: normaliseEmail applies NFC (a decomposed é becomes the composed one)", () => {
    expect(normaliseEmail("Rémy@Example.com")).toBe("rémy@example.com");
  });

  it("TP-0.2x: localPart is the text before the last @", () => {
    expect(localPart("mona@example.com")).toBe("mona");
    expect(localPart('"a@b"@example.com')).toBe('"a@b"');
  });
});
