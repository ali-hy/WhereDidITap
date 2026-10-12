// F-310 time. TP-1.11, plus the extra cases TP-1.23x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import {
  fixedClock,
  isValidTimeZone,
  systemClock,
  todayIn,
  toInstantWire,
  utcDateOf,
} from "../src/time/clock.js";
import { Temporal } from "../src/time/temporal.js";

describe("F-310 todayIn and utcDateOf", () => {
  it("TP-1.11: 22:30Z on 2026-10-05 is already 2026-10-06 in Africa/Cairo", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(todayIn(clock, "Africa/Cairo").toString()).toBe("2026-10-06");
  });

  it("TP-1.11: the same instant is 2026-10-05 in UTC", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(todayIn(clock, "UTC").toString()).toBe("2026-10-05");
  });

  it('TP-1.11: an invalid zone throws RangeError("Invalid time zone")', () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(() => todayIn(clock, "Mars/Base")).toThrow(new RangeError("Invalid time zone"));
  });

  it("TP-1.11: advancing 2 hours crosses the UTC date to 2026-10-06", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    clock.advance({ hours: 2 });

    expect(utcDateOf(clock.now()).toString()).toBe("2026-10-06");
  });

  it('TP-1.23x: todayIn with "Etc/Unknown" throws RangeError("Invalid time zone")', () => {
    expect(() => todayIn(fixedClock("2026-10-05T22:30:00Z"), "Etc/Unknown")).toThrow(
      new RangeError("Invalid time zone"),
    );
  });

  it("TP-1.23x: todayIn west of UTC is the previous date", () => {
    expect(todayIn(fixedClock("2026-10-06T02:00:00Z"), "America/New_York").toString()).toBe(
      "2026-10-05",
    );
  });
});

describe("F-310 clocks", () => {
  it("TP-1.23x: a fixed clock returns the same instant until it's moved", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(clock.now().toString()).toBe("2026-10-05T22:30:00Z");
    expect(clock.now().toString()).toBe("2026-10-05T22:30:00Z");
  });

  it("TP-1.23x: set moves a fixed clock to a string or an Instant", () => {
    const clock = fixedClock(Temporal.Instant.from("2026-01-01T00:00:00Z"));

    clock.set("2026-03-01T12:00:00Z");
    expect(clock.now().toString()).toBe("2026-03-01T12:00:00Z");

    clock.set(Temporal.Instant.from("2027-01-01T00:00:00Z"));
    expect(clock.now().toString()).toBe("2027-01-01T00:00:00Z");
  });

  it("TP-1.23x: advance accepts a duration with several units", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    clock.advance({ minutes: 45, seconds: 30 });

    expect(clock.now().toString()).toBe("2026-10-05T23:15:30Z");
  });

  it.each([["not a date"], [""], ["2026-13-01T00:00:00Z"]])(
    "TP-1.23x: fixedClock(%j) throws RangeError",
    (at) => {
      expect(() => fixedClock(at)).toThrow(RangeError);
    },
  );

  it("TP-1.23x: systemClock reads the current time", () => {
    const before = Date.now();
    const now = systemClock.now().epochMilliseconds;
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("F-310 isValidTimeZone", () => {
  it.each([["Africa/Cairo"], ["africa/cairo"], ["UTC"]])(
    "TP-1.11 (A-42): isValidTimeZone(%j) is true",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each([["Etc/Unknown"], ["+02:00"], ["-05:00"], [""], ["Mars/Base"]])(
    "TP-1.11 (A-42): isValidTimeZone(%j) is false",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );

  it('TP-1.11 (A-42): todayIn with the offset "+02:00" throws RangeError("Invalid time zone")', () => {
    expect(() => todayIn(fixedClock("2026-10-05T22:30:00Z"), "+02:00")).toThrow(
      new RangeError("Invalid time zone"),
    );
  });

  it.each([["America/New_York"], ["Asia/Kuwait"]])("TP-1.23x: %s is valid", (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it("TP-1.23x: a name with spaces is not valid", () => {
    expect(isValidTimeZone("Not A Zone")).toBe(false);
  });
});

describe("F-310 toInstantWire (A-242)", () => {
  it.each([
    ["2026-10-05T12:00:57.04Z", "2026-10-05T12:00:57.040Z"],
    ["2026-10-05T12:00:00Z", "2026-10-05T12:00:00.000Z"],
    ["2026-10-05T12:00:00.123456789Z", "2026-10-05T12:00:00.123Z"],
  ])("TP-1.11 (A-242): toInstantWire(%s) is %s", (input, wire) => {
    expect(toInstantWire(Temporal.Instant.from(input))).toBe(wire);
  });

  it("TP-1.23x (A-242): truncates rather than rounds; an offset input renders in UTC", () => {
    expect(toInstantWire(Temporal.Instant.from("2026-10-05T12:00:00.999999999Z"))).toBe(
      "2026-10-05T12:00:00.999Z",
    );
    expect(toInstantWire(Temporal.Instant.from("2026-10-05T14:00:00+02:00"))).toBe(
      "2026-10-05T12:00:00.000Z",
    );
  });
});
