// F-60 TOTP and base32 (identity LLD §4.5). TP-4.1 to TP-4.3, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "../../../src/identity/base32.js";
import { APP_NAME } from "../../../src/identity/constants.js";
import {
  generateTotpSecret,
  otpauthUri,
  stepOf,
  totpAt,
  verifyTotp,
} from "../../../src/identity/totp.js";
import { totp } from "../../support/totp.js";

/** RFC 6238's SHA-1 test secret. */
const SECRET = Buffer.from("12345678901234567890", "utf8");

describe("TP-4.1: totpAt matches RFC 6238's SHA-1 vectors (6 digits)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("TP-4.1: at %d seconds → %s", (seconds, expected) => {
    expect(totpAt(SECRET, stepOf(seconds))).toBe(expected);
  });

  it.each([
    [0, 0],
    [29, 0],
    [30, 1],
    [59, 1],
    [1111111109, 37037036],
  ])("TP-4.1x: stepOf(%d) = %d (floor of seconds / 30)", (seconds, step) => {
    expect(stepOf(seconds)).toBe(step);
  });
});

describe("TP-4.2: verifyTotp", () => {
  const NOW = 1111111111;
  const s: number = stepOf(NOW);
  const code = (step: number) => totp(SECRET, step);

  it("TP-4.2: codes for s−2 and s+2 → null; s−1, s, s+1 → that step", () => {
    expect(verifyTotp(SECRET, code(s - 2), NOW, null)).toBeNull();
    expect(verifyTotp(SECRET, code(s - 1), NOW, null)).toBe(s - 1);
    expect(verifyTotp(SECRET, code(s), NOW, null)).toBe(s);
    expect(verifyTotp(SECRET, code(s + 1), NOW, null)).toBe(s + 1);
    expect(verifyTotp(SECRET, code(s + 2), NOW, null)).toBeNull();
  });

  it("TP-4.2: the code for s with lastUsedStep = s → null (replay)", () => {
    expect(verifyTotp(SECRET, code(s), NOW, s)).toBeNull();
  });

  it('TP-4.2: "12345" (five digits) → null', () => {
    expect(verifyTotp(SECRET, "12345", NOW, null)).toBeNull();
  });

  it('TP-4.2: the code for s with a space inside ("ddd ddd") is parsed → s', () => {
    const c = code(s);

    expect(verifyTotp(SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, NOW, null)).toBe(s);
  });

  it("TP-4.2x: lastUsedStep = s − 1 skips s − 1 but still accepts s and s + 1", () => {
    expect(verifyTotp(SECRET, code(s - 1), NOW, s - 1)).toBeNull();
    expect(verifyTotp(SECRET, code(s), NOW, s - 1)).toBe(s);
    expect(verifyTotp(SECRET, code(s + 1), NOW, s - 1)).toBe(s + 1);
  });

  it("TP-4.2x: lastUsedStep = s + 1 skips the whole window", () => {
    for (const step of [s - 1, s, s + 1]) {
      expect(verifyTotp(SECRET, code(step), NOW, s + 1)).toBeNull();
    }
  });

  it.each(["", "1234567", "12a456", "-12345", "12345\n"])(
    "TP-4.2x: %j (not six digits after removing spaces) → null",
    (input) => {
      expect(verifyTotp(SECRET, input, NOW, null)).toBeNull();
    },
  );

  it("TP-4.2x: a right code for another secret → null", () => {
    const other = Buffer.from("abcdefghijabcdefghij", "utf8");
    const c = totp(other, s);
    // Guard: the two secrets' codes differ in this window.
    expect([s - 1, s, s + 1].map(code)).not.toContain(c);

    expect(verifyTotp(SECRET, c, NOW, null)).toBeNull();
  });
});

describe("TP-4.3: base32 and otpauthUri", () => {
  it('TP-4.3: base32Encode("foobar") is "MZXW6YTBOI" (upper case, no padding)', () => {
    expect(base32Encode(Buffer.from("foobar", "utf8"))).toBe("MZXW6YTBOI");
  });

  it("TP-4.3: base32Decode ignores case and spaces", () => {
    expect(Buffer.from(base32Decode("mzxw 6ytb oi")).toString("utf8")).toBe("foobar");
  });

  it('TP-4.3: base32Decode("1") throws RangeError', () => {
    expect(() => base32Decode("1")).toThrow(RangeError);
  });

  it("TP-4.3: otpauthUri for m@x.com with issuer APP_NAME is exactly the A-26 form", () => {
    expect(APP_NAME).toBe("wDit");

    expect(
      otpauthUri({
        secret: Buffer.from("foobar", "utf8"),
        accountEmail: "m@x.com",
        issuer: APP_NAME,
      }),
    ).toBe(
      "otpauth://totp/wDit:m%40x.com?secret=MZXW6YTBOI&issuer=wDit&algorithm=SHA1&digits=6&period=30",
    );
  });

  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
  ])("TP-4.3x: RFC 4648 vector %j → %j, and back", (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain, "utf8"))).toBe(encoded);
    expect(Buffer.from(base32Decode(encoded)).toString("utf8")).toBe(plain);
  });

  it.each(["MZXW0", "MZXW8", "MZ-W6"])(
    "TP-4.3x: base32Decode(%j) (a character outside the alphabet) throws RangeError",
    (input) => {
      expect(() => base32Decode(input)).toThrow(RangeError);
    },
  );

  it("TP-4.3x: otpauthUri percent-encodes the issuer and the email", () => {
    expect(
      otpauthUri({
        secret: Buffer.from("foobar", "utf8"),
        accountEmail: "a+b@x.com",
        issuer: "A B",
      }),
    ).toBe(
      "otpauth://totp/A%20B:a%2Bb%40x.com?secret=MZXW6YTBOI&issuer=A%20B&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("TP-4.3x: generateTotpSecret", () => {
  it("TP-4.3x: the secret is 20 bytes from the given source", () => {
    const secret = generateTotpSecret((n: number) => Buffer.alloc(n, 7));

    expect(Buffer.from(secret).equals(Buffer.alloc(20, 7))).toBe(true);
  });

  it("TP-4.3x: without a source, 20 random bytes, different each call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();

    expect(a).toHaveLength(20);
    expect(b).toHaveLength(20);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
