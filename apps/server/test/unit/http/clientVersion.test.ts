// F-56 parseClientHeader. TP-4.11's unit part (the middleware through HTTP is in
// integration/http/clientVersion.test.ts), plus extra cases TP-4.38x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { parseClientHeader } from "../../../src/platform/http/clientVersion.js";

describe("TP-4.11: parseClientHeader", () => {
  it.each([
    ["android/4", { kind: "android", version: 4 }],
    ["android/5", { kind: "android", version: 5 }],
    ["web/1", { kind: "web", version: 1 }],
    ["ios/1", { kind: "other", version: null }],
    [undefined, { kind: "other", version: null }],
  ] as const)("TP-4.11: %j gives %o", (header, expected) => {
    expect(parseClientHeader(header)).toEqual(expected);
  });
});

describe("TP-4.38x: parseClientHeader, malformed values (F-56)", () => {
  it.each([
    ["android/"],
    ["android/x"],
    ["Android/1"],
    ["android/12345678901"],
    [" web/1"],
    ["web/1 "],
    ["web/-1"],
    [""],
  ])("TP-4.38x: %j is other with no version", (header) => {
    expect(parseClientHeader(header)).toEqual({ kind: "other", version: null });
  });

  it("TP-4.38x: ten digits are accepted", () => {
    expect(parseClientHeader("web/1234567890")).toEqual({ kind: "web", version: 1234567890 });
  });
});
