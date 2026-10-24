// F-31: the structured logger. One JSON line per call through pino, carrying only the fixed keys,
// F-30's sanitised fields and F-33's sanitised error.
import pino from "pino";
import type { AppEnv } from "../config/schema.js";
import { sanitizeFieldsWithKeys, TOKEN, type SafeFields } from "./safeFields.js";
import { sanitizeError } from "./sanitize.js";

export type { SafeFields } from "./safeFields.js";

export type DestinationStream = pino.DestinationStream;

export interface Logger {
  debug(event: string, fields?: SafeFields): void;
  info(event: string, fields?: SafeFields): void;
  warn(event: string, fields?: SafeFields, err?: unknown): void;
  error(event: string, fields?: SafeFields, err?: unknown): void;
  child(bindings: SafeFields): Logger;
}

type Level = "debug" | "info" | "warn" | "error";

const FIXED_KEYS = new Set(["level", "time", "service", "release", "event"]);

type Sanitized = ReturnType<typeof sanitizeFieldsWithKeys>;

/** A field named like a fixed key is dropped and counted (A-113). */
function withoutFixedKeys(sanitized: Sanitized): Sanitized {
  const fields: Record<string, string | number | boolean> = {};
  const droppedKeys = [...sanitized.droppedKeys];
  let dropped = sanitized.dropped;
  for (const [key, value] of Object.entries(sanitized.fields)) {
    if (FIXED_KEYS.has(key)) {
      dropped += 1;
      droppedKeys.push(key);
    } else fields[key] = value;
  }
  return { fields, dropped, droppedKeys };
}

/** A-139: only names of this shape are written; others are counted but not named. */
const DROPPED_KEY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function createLogger(opts: {
  service: string;
  release: string;
  level: Level;
  /** A-139: `development` and `test` lines name their dropped fields (`droppedKeys`). */
  appEnv?: AppEnv;
  destination?: pino.DestinationStream;
  onDrop?: (n: number) => void;
}): Logger {
  const base = pino(
    {
      base: null,
      level: opts.level,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      // Nothing is ever serialised beyond what this module builds.
      serializers: { err: (value: unknown) => value },
    },
    opts.destination ?? pino.destination({ fd: 1, sync: true }),
  );

  const nameDrops = opts.appEnv === "development" || opts.appEnv === "test";

  const make = (bindings: Record<string, string | number | boolean>): Logger => {
    const write = (level: Level, event: string, fields?: SafeFields, err?: unknown): void => {
      try {
        if (!base.isLevelEnabled(level)) return;
        const validEvent = TOKEN.test(event);
        const sanitized = withoutFixedKeys(sanitizeFieldsWithKeys(fields ?? {}));
        const dropped = sanitized.dropped + (validEvent ? 0 : 1);
        // The fixed keys are written last, so they always win (A-113).
        const line: Record<string, unknown> = {
          ...bindings,
          ...sanitized.fields,
          service: opts.service,
          release: opts.release,
          event: validEvent ? event : "invalid_event",
        };
        if (err !== undefined) line["err"] = sanitizeError(err);
        if (dropped > 0) {
          line["dropped"] = dropped;
          // An invalid `event` is counted but never named or echoed: it may be text (A-139).
          const named = sanitized.droppedKeys.filter((key) => DROPPED_KEY_NAME.test(key));
          if (nameDrops && named.length > 0) line["droppedKeys"] = named;
          opts.onDrop?.(dropped);
        }
        base[level](line);
      } catch {
        // A logger never throws on bad input.
      }
    };
    return {
      debug: (event, fields) => {
        write("debug", event, fields);
      },
      info: (event, fields) => {
        write("info", event, fields);
      },
      warn: (event, fields, err) => {
        write("warn", event, fields, err);
      },
      error: (event, fields, err) => {
        write("error", event, fields, err);
      },
      child: (childBindings) => {
        const sanitized = withoutFixedKeys(sanitizeFieldsWithKeys(childBindings));
        if (sanitized.dropped > 0) opts.onDrop?.(sanitized.dropped);
        return make({ ...bindings, ...sanitized.fields });
      },
    };
  };
  return make({});
}
