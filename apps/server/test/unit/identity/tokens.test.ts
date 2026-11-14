// F-2 tokens (identity LLD §4.1, LD-8). TP-0.1, plus extra cases TP-0.1x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TOKEN_PREFIX,
  generateNonce,
  generateToken,
  hashToken,
  parseToken,
  type TokenKind,
} from "../../../src/identity/tokens.js";

const PREFIXES: Record<TokenKind, string> = {
  access: "bma",
  refresh: "bmr",
  challenge: "bmc",
  state: "bmg",
  handoff: "bmh",
  ticket: "bmt",
  invitation: "bmi",
  reset: "bmp",
  device: "bmd",
};

/** Deterministic bytes 0, 1, 2, … so the body is known. */
const seeded = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => i));
const SEEDED_BODY = seeded(32).toString("base64url");

describe("TP-0.1: tokens", () => {
  it("TP-0.1: TOKEN_PREFIX is LD-8's table", () => {
    expect(TOKEN_PREFIX).toEqual(PREFIXES);
  });

  it.each(Object.entries(PREFIXES))(
    "TP-0.1: generateToken(%s) is <prefix>_base64url(32 seeded bytes), 47 characters",
    (kind, prefix) => {
      const token = generateToken(kind as TokenKind, seeded);

      expect(token).toBe(`${prefix}_${SEEDED_BODY}`);
      expect(token).toHaveLength(47);
      expect(token).not.toContain("=");
    },
  );

  it("TP-0.1: generateToken asks randomBytes for exactly 32 bytes", () => {
    const asked: number[] = [];

    generateToken("access", (n) => {
      asked.push(n);
      return seeded(n);
    });

    expect(asked).toEqual([32]);
  });

  it("TP-0.1: parseToken refuses a refresh token where an access token is expected", () => {
    expect(parseToken("access", generateToken("refresh", seeded))).toBeNull();
  });

  it("TP-0.1: parseToken refuses a 42-character body", () => {
    expect(parseToken("access", `bma_${SEEDED_BODY.slice(0, 42)}`)).toBeNull();
  });

  it("TP-0.1: hashToken('x') twice gives equal 32-byte SHA-256 buffers", () => {
    const a = hashToken("x");
    const b = hashToken("x");

    expect(a).toBeInstanceOf(Buffer);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(createHash("sha256").update("x", "utf8").digest())).toBe(true);
  });
});

describe("TP-0.1x: token parsing boundaries", () => {
  it("TP-0.1x: parseToken returns the value for a well-formed token of the kind", () => {
    const token = generateToken("invitation", seeded);

    expect(parseToken("invitation", token)).toBe(token);
  });

  it.each([
    ["a 44-character body", `bma_${SEEDED_BODY}A`],
    ["a padding character", `bma_${SEEDED_BODY.slice(0, 42)}=`],
    ["a non-base64url character", `bma_${SEEDED_BODY.slice(0, 42)}+`],
    ["an upper-case prefix", `BMA_${SEEDED_BODY}`],
    ["no separator", `bma${SEEDED_BODY}`],
    ["leading whitespace", ` bma_${SEEDED_BODY}`],
    ["trailing newline", `bma_${SEEDED_BODY}\n`],
    ["an empty string", ""],
  ])("TP-0.1x: parseToken refuses %s", (_label, value) => {
    expect(parseToken("access", value)).toBeNull();
  });

  it.each([[undefined], [null], [42], [{}], [["bma_x"]]])(
    "TP-0.1x: parseToken(%j) returns null without throwing",
    (value) => {
      expect(parseToken("access", value)).toBeNull();
    },
  );

  it("TP-0.1x: generateNonce is base64url(32 bytes) with no prefix, 43 characters", () => {
    const nonce = generateNonce(seeded);

    expect(nonce).toBe(SEEDED_BODY);
    expect(nonce).toHaveLength(43);
  });

  it("TP-0.1x: without an injected source, two tokens differ", () => {
    expect(generateToken("access")).not.toBe(generateToken("access"));
  });
});
