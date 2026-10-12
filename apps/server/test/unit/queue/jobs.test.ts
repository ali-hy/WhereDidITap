// F-70 defineJob, F-71 createJobRegistry, F-72 assertPayloadSafe. TP-6.1 to TP-6.3, plus extra
// cases TP-6.22x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { CANARIES } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJob } from "../../../src/platform/queue/jobs.js";
import {
  UnsafeJobPayloadError,
  assertPayloadSafe,
} from "../../../src/platform/queue/payloadSafety.js";
import { createJobRegistry } from "../../../src/platform/queue/registry.js";

const payload = z.object({});

describe("TP-6.1: defineJob (F-70)", () => {
  it("TP-6.1: the defaults are retryLimit 5, retryDelaySeconds 30, retryBackoff true, expireInSeconds 900, policy standard", () => {
    const def = defineJob({ name: "test.thing", role: "general", payload });

    expect(def).toMatchObject({
      name: "test.thing",
      role: "general",
      retryLimit: 5,
      retryDelaySeconds: 30,
      retryBackoff: true,
      expireInSeconds: 900,
      policy: "standard",
    });
    expect(def.payload).toBe(payload);
    expect(def.cron).toBeUndefined();
  });

  it.each([
    ["the name Bad", { name: "Bad", role: "general" as const }],
    ["a cron on the capture role", { name: "test.c", role: "capture" as const, cron: "0 3 * * *" }],
    ["the cron '* *'", { name: "test.c", role: "general" as const, cron: "* *" }],
  ])("TP-6.1: %s throws TypeError", (_label, def) => {
    expect(() => defineJob({ ...def, payload })).toThrow(TypeError);
  });
});

describe("TP-6.22x: defineJob, further cases (F-70)", () => {
  it.each([["platform"], ["a.B"], ["1a.b"], ["a.b.c"], ["a_b.c"], [""]])(
    "TP-6.22x: the name %j throws TypeError",
    (name) => {
      expect(() => defineJob({ name, role: "general", payload })).toThrow(TypeError);
    },
  );

  it.each([["platform.idempotency-purge"], ["fx.gap-check"], ["a1.b-2"]])(
    "TP-6.22x: the name %j is accepted",
    (name) => {
      expect(defineJob({ name, role: "general", payload }).name).toBe(name);
    },
  );

  it("TP-6.22x: a general job with a 5-field cron keeps it; given options override the defaults", () => {
    const def = defineJob({
      name: "test.cron",
      role: "general",
      payload,
      cron: "*/10 * * * *",
      retryLimit: 2,
      policy: "singleton",
    });

    expect(def).toMatchObject({ cron: "*/10 * * * *", retryLimit: 2, policy: "singleton" });
  });
});

describe("TP-6.2: createJobRegistry (F-71)", () => {
  it("TP-6.2: duplicate names throw TypeError", () => {
    const a = defineJob({ name: "test.a", role: "general", payload });

    expect(() =>
      createJobRegistry([a, defineJob({ name: "test.a", role: "capture", payload })]),
    ).toThrow(TypeError);
  });

  it("TP-6.2: a name starting with dead-letter. throws TypeError", () => {
    // defineJob refuses the name already, so the definition is a literal.
    const dead = {
      name: "dead-letter.x",
      role: "general" as const,
      payload,
      retryLimit: 5,
      retryDelaySeconds: 30,
      retryBackoff: true,
      expireInSeconds: 900,
      policy: "standard" as const,
    };

    expect(() => createJobRegistry([dead])).toThrow(TypeError);
  });

  it("TP-6.2: deadLetterQueue('general') is dead-letter.general, and capture's dead-letter.capture", () => {
    const registry = createJobRegistry([]);

    expect(registry.deadLetterQueue("general")).toBe("dead-letter.general");
    expect(registry.deadLetterQueue("capture")).toBe("dead-letter.capture");
  });
});

describe("TP-6.22x: createJobRegistry, further cases (F-71)", () => {
  it("TP-6.22x: all, forRole and get return the definitions; dead-letter queues aren't definitions", () => {
    const g = defineJob({ name: "test.g", role: "general", payload });
    const c = defineJob({ name: "test.c", role: "capture", payload });

    const registry = createJobRegistry([g, c]);

    expect(registry.all()).toEqual([g, c]);
    expect(registry.forRole("general")).toEqual([g]);
    expect(registry.forRole("capture")).toEqual([c]);
    expect(registry.get("test.c")).toBe(c);
    expect(registry.get("dead-letter.general")).toBeUndefined();
    expect(registry.get("test.none")).toBeUndefined();
  });
});

describe("TP-6.3: assertPayloadSafe (F-72)", () => {
  it("TP-6.3: {id: uuid, d: 2026-10-05, n: 3, ok: true} passes", () => {
    expect(() => {
      assertPayloadSafe({
        id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
        d: "2026-10-05",
        n: 3,
        ok: true,
      });
    }).not.toThrow();
  });

  it.each([
    ["{note: 'has space'}", { note: "has space" }, "note", "has space"],
    ["{a: 'x' × 65}", { a: "x".repeat(65) }, "a", "x".repeat(65)],
    ["{a: {b: {c: 1}}}", { a: { b: { c: 1 } } }, "a.b", undefined],
    ["{a: Array(101)}", { a: Array<number>(101).fill(1) }, "a", undefined],
    ["{a: [canary + ' x']}", { a: [`${CANARIES.payee} x`] }, "a.0", `${CANARIES.payee} x`],
  ])(
    "TP-6.3: %s throws UnsafeJobPayloadError with path %s and a message without the value",
    (_label, value, path, raw) => {
      let caught: unknown;
      try {
        assertPayloadSafe(value);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UnsafeJobPayloadError);
      const error = caught as Error & { path: string };
      expect(error.path).toBe(path);
      expect(error.message).toBe(`Unsafe job payload at ${path}`);
      if (raw !== undefined) expect(error.message).not.toContain(raw);
      expect(error.message).not.toContain(CANARIES.payee);
    },
  );
});

describe("TP-6.22x: assertPayloadSafe, further cases (F-72)", () => {
  it.each([
    ["an RFC 3339 instant", { at: "2026-10-05T12:00:00.000Z" }],
    ["an enum token with + and :", { t: "a+b:c" }],
    ["null", { x: null }],
    ["an array of 100 scalars", { a: Array<number>(100).fill(1) }],
    ["one nested object", { a: { b: 1, c: "x", d: null } }],
    ["an empty object", {}],
  ])("TP-6.22x: %s passes", (_label, value) => {
    expect(() => {
      assertPayloadSafe(value);
    }).not.toThrow();
  });

  it.each([
    ["an empty string", { s: "" }, "s"],
    ["Infinity", { n: Infinity }, "n"],
    ["NaN", { n: Number.NaN }, "n"],
    ["an array holding an object", { a: [{ b: 1 }] }, "a.0"],
    ["a nested array of objects", { a: { b: [{ c: 1 }] } }, "a.b.0"],
    ["a string with /", { s: "a/b" }, "s"],
  ])("TP-6.22x: %s throws with path %s", (_label, value, path) => {
    expect(() => {
      assertPayloadSafe(value);
    }).toThrow(UnsafeJobPayloadError);
    try {
      assertPayloadSafe(value);
    } catch (error) {
      expect((error as { path: string }).path).toBe(path);
    }
  });

  it.each([
    ["an array", [1]],
    ["a string", "x"],
    ["null", null],
    ["a Date", new Date(0)],
  ])("TP-6.22x: a payload that is %s, not a plain object, is refused", (_label, value) => {
    expect(() => {
      assertPayloadSafe(value);
    }).toThrow(UnsafeJobPayloadError);
  });
});
