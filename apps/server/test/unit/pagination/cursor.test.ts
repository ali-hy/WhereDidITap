// F-103 createCursorCodec, F-104 filterHash, F-105 paginate. TP-7.10 to TP-7.13, plus extra cases
// TP-7.16x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { fixedClock } from "@budmon/shared";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { ValidationFailedError } from "../../../src/platform/errors/platformErrors.js";
import {
  type CursorCodec,
  createCursorCodec,
  filterHash,
  paginate,
} from "../../../src/platform/pagination/cursor.js";

const KEY = Buffer.alloc(32, 7);
const FILTER = "AAAAAAAAAAAAAAAAAAAAAA";
const ID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";

function codecAt(at = "2026-10-09T12:00:00Z") {
  const clock = fixedClock(at);
  return { codec: createCursorCodec({ key: KEY, clock }), clock };
}

/** The error decode throws, which must be F-103's single invalid_cursor issue. */
function invalidCursor(codec: CursorCodec, token: string, filter = FILTER): void {
  let caught: unknown;
  try {
    codec.decode(token, filter);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationFailedError);
  expect((caught as ValidationFailedError).details).toEqual({
    issues: [{ path: ["cursor"], code: "invalid_cursor", message: "Invalid cursor" }],
  });
}

describe("TP-7.10: createCursorCodec (F-103)", () => {
  it("TP-7.10: encode then decode round-trips the sort key and id", () => {
    const { codec } = codecAt();
    const sortKey = ["2026-10-05", 1200, true, null] as const;

    const token = codec.encode({ sortKey, id: ID, filterHash: FILTER });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codec.decode(token, FILTER)).toEqual({ sortKey: [...sortKey], id: ID });
  });

  it("TP-7.10: one flipped byte is invalid_cursor", () => {
    const { codec } = codecAt();
    const token = codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 5] = (bytes[bytes.length - 5] ?? 0) ^ 0x01;

    invalidCursor(codec, bytes.toString("base64url"));
  });

  it("TP-7.10: 24 h + 1 s later the cursor has expired: invalid_cursor", () => {
    const { codec, clock } = codecAt();
    const token = codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });

    clock.advance({ hours: 24, seconds: 1 });

    invalidCursor(codec, token);
  });

  it("TP-7.10: a wrong filter hash is invalid_cursor", () => {
    const { codec } = codecAt();
    const token = codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });

    invalidCursor(codec, token, "BBBBBBBBBBBBBBBBBBBBBB");
  });

  it("TP-7.10: a 513-character token is invalid_cursor", () => {
    const { codec } = codecAt();

    invalidCursor(codec, "A".repeat(513));
  });

  it("TP-7.10: a non-base64 token is invalid_cursor", () => {
    const { codec } = codecAt();

    invalidCursor(codec, "not base64!*");
  });

  // A-244: tokens encoded with a clock 4 min, 6 min and 25 h ahead, decoded at the real time.
  it("TP-7.10 (A-244): encoded 4 min ahead (exp = now + 24 h 4 min) is accepted", () => {
    const token = codecAt("2026-10-09T12:04:00Z").codec.encode({
      sortKey: ["a"],
      id: ID,
      filterHash: FILTER,
    });

    expect(codecAt().codec.decode(token, FILTER).id).toBe(ID);
  });

  it.each([
    ["6 min", "2026-10-09T12:06:00Z"],
    ["25 h", "2026-10-10T13:00:00Z"],
  ])("TP-7.10 (A-244): encoded %s ahead is invalid_cursor", (_label, at) => {
    const token = codecAt(at).codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });

    invalidCursor(codecAt().codec, token);
  });

  it("TP-7.16x (A-243): exp exactly 24 h + 5 min ahead is accepted; 1 s more is invalid_cursor", () => {
    const atBound = codecAt("2026-10-09T12:05:00Z").codec.encode({
      sortKey: ["a"],
      id: ID,
      filterHash: FILTER,
    });
    const past = codecAt("2026-10-09T12:05:01Z").codec.encode({
      sortKey: ["a"],
      id: ID,
      filterHash: FILTER,
    });

    expect(codecAt().codec.decode(atBound, FILTER).id).toBe(ID);
    invalidCursor(codecAt().codec, past);
  });
});

describe("TP-7.16x: createCursorCodec, further cases (F-103)", () => {
  it("TP-7.16x: exactly 24 h later the cursor is still valid (exp ≥ now)", () => {
    const { codec, clock } = codecAt();
    const token = codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });

    clock.advance({ hours: 24 });

    expect(codec.decode(token, FILTER).id).toBe(ID);
  });

  it("TP-7.16x: the token is 0x01 ‖ 12-byte nonce ‖ ciphertext ‖ 16-byte tag, base64url without padding", () => {
    const codec = createCursorCodec({
      key: KEY,
      clock: fixedClock("2026-10-09T12:00:00Z"),
      randomBytes: (n) => Buffer.alloc(n, 0xab),
    });

    const token = codec.encode({ sortKey: [], id: ID, filterHash: FILTER });
    const bytes = Buffer.from(token, "base64url");

    expect(token).not.toContain("=");
    expect(bytes[0]).toBe(0x01);
    expect(bytes.subarray(1, 13)).toEqual(Buffer.alloc(12, 0xab));
    expect(bytes.length).toBeGreaterThan(1 + 12 + 16);
  });

  it("TP-7.16x: two encodes of the same position differ (random nonce) and both decode", () => {
    const { codec } = codecAt();
    const p = { sortKey: ["a"], id: ID, filterHash: FILTER } as const;

    const one = codec.encode(p);
    const two = codec.encode(p);

    expect(one).not.toBe(two);
    expect(codec.decode(one, FILTER)).toEqual(codec.decode(two, FILTER));
  });

  it("TP-7.16x: another key's cursor is invalid_cursor; so is a wrong version byte", () => {
    const clock = fixedClock("2026-10-09T12:00:00Z");
    const other = createCursorCodec({ key: Buffer.alloc(32, 9), clock });
    const { codec } = codecAt();
    const token = other.encode({ sortKey: ["a"], id: ID, filterHash: FILTER });
    const versioned = Buffer.from(
      codec.encode({ sortKey: ["a"], id: ID, filterHash: FILTER }),
      "base64url",
    );
    versioned[0] = 0x02;

    invalidCursor(codec, token);
    invalidCursor(codec, versioned.toString("base64url"));
  });

  it("TP-7.16x: an empty token is invalid_cursor", () => {
    const { codec } = codecAt();

    invalidCursor(codec, "");
  });
});

describe("TP-7.11: no plaintext in cursors (F-103)", () => {
  it("TP-7.11: a canary sort key appears neither in the token nor in its base64 decode", () => {
    const { codec } = codecAt();

    const token = codec.encode({ sortKey: [CANARIES.payee], id: ID, filterHash: FILTER });
    const decoded = Buffer.from(token, "base64url").toString("latin1");

    expect(
      scanForCanaries(
        [
          { name: "token", text: token },
          { name: "decoded", text: decoded },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });
});

describe("TP-7.12: paginate (F-105)", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `0190a0b0-1c2d-7e3f-8a4b-${String(i).padStart(12, "0")}`,
      at: i,
    }));

  it("TP-7.12: 51 rows with limit 50: 50 items and a cursor at the 50th row", () => {
    const { codec } = codecAt();
    const all = rows(51);

    const page = paginate(all, 50, (r) => ({ sortKey: [r.at], id: r.id }), FILTER, codec);

    expect(page.items).toEqual(all.slice(0, 50));
    expect(page.nextCursor).not.toBeNull();
    expect(codec.decode(page.nextCursor ?? "", FILTER)).toEqual({ sortKey: [49], id: all[49]?.id });
  });

  it("TP-7.12: 50 rows with limit 50: 50 items and nextCursor null", () => {
    const { codec } = codecAt();
    const all = rows(50);

    const page = paginate(all, 50, (r) => ({ sortKey: [r.at], id: r.id }), FILTER, codec);

    expect(page.items).toEqual(all);
    expect(page.nextCursor).toBeNull();
  });

  it("TP-7.16x: no rows: no items and nextCursor null", () => {
    const { codec } = codecAt();

    expect(paginate([], 50, () => ({ sortKey: [], id: ID }), FILTER, codec)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("TP-7.13: filterHash (F-104)", () => {
  it("TP-7.13: key order doesn't matter; the hash is 22 base64url characters", () => {
    const one = filterHash({ a: 1, b: [1, 2] });
    const two = filterHash({ b: [1, 2], a: 1 });

    expect(one).toBe(two);
    expect(one).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("TP-7.13: array order does matter", () => {
    expect(filterHash({ b: [2, 1] })).not.toBe(filterHash({ b: [1, 2] }));
  });

  it("TP-7.16x: it is the first 22 characters of base64url(sha256(canonicalJson(filters)))", async () => {
    const { createHash } = await import("node:crypto");

    expect(filterHash({ b: [1, 2], a: 1 })).toBe(
      createHash("sha256").update('{"a":1,"b":[1,2]}').digest("base64url").slice(0, 22),
    );
  });
});
