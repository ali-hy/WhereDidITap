// F-66 hashing utilities. TP-5.9 (with A-200's randomToken bounds), plus extra cases TP-5.11x
// (salt, sha256, timingSafeEqualBytes on equal input). IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import {
  hashSecret,
  hmacSha256,
  randomToken,
  sha256,
  timingSafeEqualBytes,
  verifySecret,
} from "../../../src/platform/security/hashing.js";

describe("TP-5.9: F-66 hashing utilities", () => {
  it("TP-5.9: hashSecret gives an Argon2id PHC string with F-66's parameters", async () => {
    const phc = await hashSecret("pw");

    expect(phc.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
  });

  it("TP-5.9: verifySecret is true for the password, false for another, false for a malformed PHC", async () => {
    const phc = await hashSecret("pw");

    expect(await verifySecret(phc, "pw")).toBe(true);
    expect(await verifySecret(phc, "x")).toBe(false);
    expect(await verifySecret("garbage", "pw")).toBe(false);
  });

  it("TP-5.9: timingSafeEqualBytes with different lengths is false", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("TP-5.9: randomToken() is 43 base64url characters", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("TP-5.9: randomToken(8) throws RangeError", () => {
    expect(() => randomToken(8)).toThrow(RangeError);
  });

  it.each([
    [16, 22],
    [64, 86],
  ])("TP-5.9: (A-200) randomToken(%i) is %i base64url characters, no padding", (bytes, length) => {
    expect(randomToken(bytes)).toMatch(new RegExp(`^[A-Za-z0-9_-]{${String(length)}}$`));
  });

  it.each([[15], [65], [96]])("TP-5.9: (A-200) randomToken(%i) throws RangeError", (bytes) => {
    expect(() => randomToken(bytes)).toThrow(RangeError);
  });

  it("TP-5.9: hmacSha256('key', the quick brown fox) is the known value", () => {
    expect(
      hmacSha256(Buffer.from("key"), "The quick brown fox jumps over the lazy dog").toString("hex"),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});

describe("TP-5.11x: F-66, further cases", () => {
  it("TP-5.11x: two hashes of the same password differ (16-byte random salt)", async () => {
    expect(await hashSecret("pw")).not.toBe(await hashSecret("pw"));
  });

  it("TP-5.11x: timingSafeEqualBytes is true for equal bytes and false for one differing byte", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("TP-5.11x: two random tokens differ", () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it("TP-5.11x: sha256('abc') is the FIPS 180-2 value", () => {
    expect(sha256("abc").toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("TP-5.11x: hmacSha256 takes a Buffer as data too", () => {
    expect(
      hmacSha256(Buffer.from("key"), Buffer.from("The quick brown fox jumps over the lazy dog")),
    ).toEqual(hmacSha256(Buffer.from("key"), "The quick brown fox jumps over the lazy dog"));
  });
});
