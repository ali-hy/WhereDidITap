// F-311 IDs. TP-1.12, plus the extra cases TP-1.24x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { isUuid, uuidv7Generator } from "../src/ids/ids.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("F-311 uuidv7Generator", () => {
  it("TP-1.12: 1000 IDs are lower-case UUIDv7s in non-decreasing order", () => {
    const ids = Array.from({ length: 1000 }, () => uuidv7Generator.next());

    expect(ids.filter((id) => !UUID_V7.test(id))).toEqual([]);
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i - 1] ?? "") <= (ids[i] ?? "")).toBe(true);
    }
  });

  it("TP-1.24x: generated IDs pass isUuid", () => {
    expect(isUuid(uuidv7Generator.next())).toBe(true);
  });
});

describe("F-311 isUuid", () => {
  it.each([
    ["a v4", "f47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["a v7", "01927f3a-6b1c-7d2e-8f00-123456789abc"],
  ])("TP-1.12 (A-41): accepts %s", (_label, value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ["a v7 in upper case", "01927F3A-6B1C-7D2E-8F00-123456789ABC"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
    ["max", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
    ["version 0", "01927f3a-6b1c-0d2e-8f00-123456789abc"],
    ["version 9", "01927f3a-6b1c-9d2e-8f00-123456789abc"],
    ["variant c", "01927f3a-6b1c-7d2e-cf00-123456789abc"],
    ["braces", "{01927f3a-6b1c-7d2e-8f00-123456789abc}"],
    ["a urn:uuid: prefix", "urn:uuid:01927f3a-6b1c-7d2e-8f00-123456789abc"],
    ["no dashes", "01927f3a6b1c7d2e8f00123456789abc"],
  ])("TP-1.12 (A-41): rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it.each([
    ["too short", "f47ac10b-58cc-4372-a567-0e02b2c3d47"],
    ["non-hex", "g47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["empty", ""],
  ])("TP-1.24x: rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
