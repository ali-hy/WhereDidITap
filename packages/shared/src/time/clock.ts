// F-310: clocks and time zones. Temporal is always the polyfill (A-34).
import { Temporal } from "./temporal.js";

export interface Clock {
  now(): Temporal.Instant;
}

export const systemClock: Clock = {
  now: () => Temporal.Instant.fromEpochMilliseconds(Date.now()),
};

export interface MutableClock extends Clock {
  set(at: Temporal.Instant | string): void;
  advance(by: Temporal.DurationLike): void;
}

function toInstant(at: Temporal.Instant | string): Temporal.Instant {
  return typeof at === "string" ? Temporal.Instant.from(at) : at;
}

export function fixedClock(at: Temporal.Instant | string): MutableClock {
  let current = toInstant(at);
  return {
    now: () => current,
    set: (to) => {
      current = toInstant(to);
    },
    advance: (by) => {
      current = current.add(by);
    },
  };
}

export function isValidTimeZone(zone: string): boolean {
  if (zone === "Etc/Unknown" || zone.startsWith("+") || zone.startsWith("-")) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function todayIn(clock: Clock, timeZone: string): Temporal.PlainDate {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError("Invalid time zone");
  }
  return clock.now().toZonedDateTimeISO(timeZone).toPlainDate();
}

/** A-242: instants on the wire, always `YYYY-MM-DDTHH:MM:SS.sssZ` (truncated to milliseconds). */
export function toInstantWire(i: Temporal.Instant): string {
  return i
    .round({ smallestUnit: "millisecond", roundingMode: "trunc" })
    .toString({ fractionalSecondDigits: 3 });
}

export function utcDateOf(instant: Temporal.Instant): Temporal.PlainDate {
  return instant.toZonedDateTimeISO("UTC").toPlainDate();
}
