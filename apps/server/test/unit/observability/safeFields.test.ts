// F-30 safe log fields. TP-3.1, plus extra cases TP-3.19x (each kind's value rule at its edges,
// and the closed set). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { SAFE_LOG_FIELDS, sanitizeFields } from "../../../src/platform/observability/safeFields.js";

describe("TP-3.1: sanitizeFields", () => {
  it("TP-3.1: removes unknown keys, replaces invalid values with [invalid], and counts both", () => {
    const result = sanitizeFields({
      userId: "u1",
      payee: "x",
      count: -1,
      route: "/a b",
      rateDate: "2026-10-05",
    });

    expect(result).toEqual({
      fields: { userId: "u1", count: "[invalid]", route: "[invalid]", rateDate: "2026-10-05" },
      dropped: 3,
    });
  });

  it("TP-3.1 (A-308): route /dev/objects/* is kept; /a* and /a/*/b are [invalid]", () => {
    expect(sanitizeFields({ route: "/dev/objects/*" })).toEqual({
      fields: { route: "/dev/objects/*" },
      dropped: 0,
    });
    expect(sanitizeFields({ route: "/a*" }).fields).toEqual({ route: "[invalid]" });
    expect(sanitizeFields({ route: "/a/*/b" }).fields).toEqual({ route: "[invalid]" });
  });
});

describe("TP-3.19x: the closed set (F-30)", () => {
  it("TP-3.19x: SAFE_LOG_FIELDS is exactly F-30's table", () => {
    const kinds: Record<string, readonly string[]> = {
      id: ["requestId", "traceId", "spanId", "userId", "entityId", "jobId"],
      token: [
        "event",
        "step",
        "jobName",
        "queue",
        "method",
        "statusClass",
        "errorClass",
        "errorCode",
        "clientKind",
        "module",
        "outcome",
        "provider",
        "currency",
        "service",
        "release",
        "role",
        "limiter",
        "signal",
        "reason",
        // A-306: the bucket of object_keys_skipped.
        "bucket",
      ],
      route: ["route"],
      count: ["status", "count", "attempt", "clientVersion", "dropped", "inserted", "rejected"],
      duration: ["durationMs"],
      bool: ["retryable", "replayed", "provisional"],
      errorKey: ["errorKey"],
      date: ["rateDate"],
    };
    const expected = Object.fromEntries(
      Object.entries(kinds).flatMap(([kind, fields]) => fields.map((f) => [f, kind])),
    );

    expect({ ...SAFE_LOG_FIELDS }).toEqual(expected);
  });

  it("TP-3.19x: no fields gives no fields and nothing dropped", () => {
    expect(sanitizeFields({})).toEqual({ fields: {}, dropped: 0 });
  });
});

describe("TP-3.19x: value rules per kind, at their edges", () => {
  const valid: [string, string, unknown][] = [
    ["id, 64 characters", "requestId", "a".repeat(64)],
    ["id with . : - _", "traceId", "a.b:c-d_e"],
    ["token, 1 character", "event", "x"],
    ["route, the root", "route", "/"],
    ["route with a template", "route", "/v1/entries/{id}"],
    ["route, 201 characters", "route", `/${"a".repeat(200)}`],
    ["count, 0", "count", 0],
    ["count, MAX_SAFE_INTEGER", "attempt", Number.MAX_SAFE_INTEGER],
    ["duration, 0", "durationMs", 0],
    ["duration, a fraction", "durationMs", 1.5],
    ["bool, false", "retryable", false],
    ["errorKey, 2 characters", "errorKey", "AB"],
    ["errorKey, 64 characters", "errorKey", `A${"B".repeat(63)}`],
    ["date", "rateDate", "2026-01-31"],
  ];

  it.each(valid)("TP-3.19x: %s is kept", (_label, key, value) => {
    expect(sanitizeFields({ [key]: value })).toEqual({ fields: { [key]: value }, dropped: 0 });
  });

  const invalid: [string, string, unknown][] = [
    ["id, 65 characters", "requestId", "a".repeat(65)],
    ["id, empty", "userId", ""],
    ["id with a space", "entityId", "a b"],
    ["id as a number", "jobId", 1],
    ["token with a slash", "event", "a/b"],
    ["token holding an email", "provider", "x@example.com"],
    ["route without the leading slash", "route", "a"],
    ["route, 202 characters", "route", `/${"a".repeat(201)}`],
    ["route with a query", "route", "/a?b=1"],
    ["count, negative", "count", -1],
    ["count, a fraction", "count", 1.5],
    ["count, beyond MAX_SAFE_INTEGER", "count", Number.MAX_SAFE_INTEGER + 1],
    ["count as a string", "status", "200"],
    ["duration, negative", "durationMs", -0.1],
    ["duration, NaN", "durationMs", Number.NaN],
    ["duration, Infinity", "durationMs", Number.POSITIVE_INFINITY],
    ["bool as a string", "replayed", "true"],
    ["errorKey, 1 character", "errorKey", "A"],
    ["errorKey, 65 characters", "errorKey", `A${"B".repeat(64)}`],
    ["errorKey, lower case", "errorKey", "not_found"],
    ["errorKey starting with a digit", "errorKey", "1ABC"],
    ["date with a time", "rateDate", "2026-01-31T00:00:00Z"],
    ["date, short year", "rateDate", "26-01-31"],
    ["an object", "userId", { id: "u1" }],
    ["null", "userId", null],
  ];

  it.each(invalid)("TP-3.19x: %s is [invalid] and counted", (_label, key, value) => {
    expect(sanitizeFields({ [key]: value })).toEqual({
      fields: { [key]: "[invalid]" },
      dropped: 1,
    });
  });

  it("TP-3.19x: inherited and prototype-like keys are unknown", () => {
    expect(
      sanitizeFields(JSON.parse('{"__proto__":"x","constructor":"y"}') as Record<string, unknown>),
    ).toEqual({
      fields: {},
      dropped: 2,
    });
  });
});
