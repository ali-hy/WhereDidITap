// F-340: calendar dates and instants on the wire.
import { z } from "zod";

function isCalendarDate(value: string): boolean {
  const [y = "", m = "", d = ""] = value.split("-");
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(m, 10);
  const day = Number.parseInt(d, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A real instant: the string is exactly what Date renders for it (no 24:00, no 30 February). */
function isInstant(value: string): boolean {
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

export const PlainDateWire = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "Invalid date" });

/** A-242: RFC 3339 in UTC at millisecond precision, always `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export const InstantWire = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(isInstant, { message: "Invalid instant" });
