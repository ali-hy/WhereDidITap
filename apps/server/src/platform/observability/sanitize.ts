// F-33 sanitizeError and buildErrorEvent, and F-37 stripQuery: what may leave the process about
// an error or a URL.
import path from "node:path";
import { serverRoot } from "../config/serverRoot.js";
import { BudmonError } from "../errors/BudmonError.js";
import { ERROR_KEY, TOKEN } from "./safeFields.js";

export interface SanitizedError {
  class: string;
  key?: string;
  code?: string;
  status?: number;
  reason?: string;
  frames: string[];
}

export interface EventFrame {
  function?: string;
  filename: string;
  lineno: number;
  colno: number;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const SYSTEM_CODE = /^E[A-Z0-9_]{1,30}$/;
const MAX_FRAMES = 30;

/** V8's frame grammar: `at <fn> (<file>:<line>:<col>)` or `at <file>:<line>:<col>`. */
const V8_FRAME = /^at (?:(.+) \((.+):(\d+):(\d+)\)|(.+):(\d+):(\d+))$/;
/** A-110's rules for the parts a frame is rebuilt from. */
// A space only after a leading `async ` or `new ` (A-119).
export const FRAME_FUNCTION = /^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_$.<>[\]]{0,99}$/;
export const FRAME_FILENAME = /^[A-Za-z0-9_@./<>:-]{1,200}$/;

/** A property read that never throws: a throwing getter or proxy counts as absent (A-132). */
function get(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** `err instanceof Error`, false when the check itself throws (a proxy's prototype trap). */
function isErrorInstance(err: unknown): err is Error {
  try {
    return err instanceof Error;
  } catch {
    return false;
  }
}

/** The class token, or `undefined` when `constructor`, its `name` or the error's own `name` can't
 * be read (A-132). */
function className(err: Error): string | undefined {
  try {
    // Read only to learn whether it throws.
    Reflect.get(err, "name");
    const name: unknown = err.constructor.name;
    return token(name) ?? "Error";
  } catch {
    return undefined;
  }
}

function budmonKey(err: unknown): string | undefined {
  try {
    if (!(err instanceof BudmonError)) return undefined;
    const key: unknown = err.key;
    return typeof key === "string" && ERROR_KEY.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

function validStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

let rootCache: string | null | undefined;

function repositoryRoot(): string | null {
  if (rootCache === undefined) {
    try {
      rootCache = path.join(serverRoot(), "../..");
    } catch {
      rootCache = null;
    }
  }
  return rootCache;
}

/** Reduces a frame's location to something that can't carry user text (A-110). */
export function reduceFilename(raw: string): string {
  const file = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  const modules = file.indexOf("/node_modules/");
  if (modules >= 0) return file.slice(modules + 1);
  const root = repositoryRoot();
  if (root !== null && file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  if (file.startsWith("node:")) return file;
  // Already reduced (a repository-relative or node_modules/ path): unchanged, so the reduction can
  // be applied twice (F-35 re-checks frames).
  if (!file.startsWith("/") && !file.includes(":") && !file.includes("\\")) return file;
  return "<unknown>";
}

function parseFrame(line: string): EventFrame | null {
  const match = V8_FRAME.exec(line);
  if (match === null) return null;
  const fn = match[1];
  const location = match[2] ?? match[5] ?? "";
  const lineno = Number.parseInt(match[3] ?? match[6] ?? "", 10);
  const colno = Number.parseInt(match[4] ?? match[7] ?? "", 10);
  if (fn !== undefined && !FRAME_FUNCTION.test(fn)) return null;
  const filename = reduceFilename(location);
  if (!FRAME_FILENAME.test(filename)) return null;
  return { ...(fn === undefined ? {} : { function: fn }), filename, lineno, colno };
}

function frameLine(frame: EventFrame): string {
  const location = `${frame.filename}:${String(frame.lineno)}:${String(frame.colno)}`;
  return frame.function === undefined ? `at ${location}` : `at ${frame.function} (${location})`;
}

/** The parsed frames of an error's stack, newest first, taken only after the header. */
function stackFrames(err: Error): EventFrame[] {
  let header: string;
  let stack: unknown;
  try {
    header = String(err);
    stack = err.stack;
  } catch {
    return [];
  }
  // A replaced or custom stack can't be split safely from the message (A-110).
  if (typeof stack !== "string" || !stack.startsWith(`${header}\n`)) return [];
  const frames: EventFrame[] = [];
  for (const line of stack.slice(header.length + 1).split("\n")) {
    const frame = parseFrame(line.trim());
    if (frame !== null) frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

export function sanitizeError(err: unknown): SanitizedError {
  try {
    return sanitizeUnguarded(err);
  } catch {
    // Every read below is already guarded; this is the backstop for "never throws" (A-132).
    return { class: "NonError", frames: [] };
  }
}

function sanitizeUnguarded(err: unknown): SanitizedError {
  const isError = isErrorInstance(err);
  const cls = isError ? className(err) : undefined;
  const result: SanitizedError = { class: cls ?? "NonError", frames: [] };

  const key = budmonKey(err);
  if (key !== undefined) result.key = key;

  const code = get(err, "code");
  if (typeof code === "string" && (SQLSTATE.test(code) || SYSTEM_CODE.test(code))) {
    result.code = code;
  }

  const status =
    validStatus(get(err, "status")) ??
    validStatus(get(get(err, "response"), "status")) ??
    validStatus(get(err, "statusCode"));
  if (status !== undefined) result.status = status;

  const googleError = get(get(get(err, "response"), "data"), "error");
  if (googleError !== undefined) {
    const errors = get(googleError, "errors");
    const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
    const reason = token(get(first, "reason")) ?? token(get(googleError, "status"));
    if (reason !== undefined) result.reason = reason;
  }

  if (isError && cls !== undefined) result.frames = stackFrames(err).map(frameLine);
  return result;
}

/** The Sentry exception for an error, from the sanitised parts only (A-110). Frames are innermost
 * last, as Sentry expects. */
export function buildErrorEvent(err: unknown): {
  type: string;
  value: string;
  stacktrace: { frames: EventFrame[] };
} {
  const s = sanitizeError(err);
  let frames: EventFrame[] = [];
  if (s.class !== "NonError" && isErrorInstance(err)) {
    try {
      frames = stackFrames(err).reverse();
    } catch {
      frames = [];
    }
  }
  return { type: s.class, value: s.key ?? s.code ?? s.class, stacktrace: { frames } };
}

/** `scheme://host[:port]/path`, without user info, query or fragment. */
export function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.host === "") return "[invalid-url]";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

/** A path without its query or fragment (F-37's rule applied to a route or `url.path`). */
export function stripPathQuery(value: string): string {
  return value.split(/[?#]/)[0] ?? "";
}
