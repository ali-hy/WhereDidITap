// F-312 (A-319): bidi isolation of message arguments, only where it can't change formatting.
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { isolate } from "./bidi.js";

/** For each argument name, whether every use of it in the message is a plain `{name}`. */
function argumentUses(ast: readonly MessageFormatElement[], uses: Map<string, boolean>): void {
  for (const el of ast) {
    switch (el.type) {
      case TYPE.argument:
        uses.set(el.value, uses.get(el.value) ?? true);
        break;
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        uses.set(el.value, false);
        break;
      case TYPE.select:
      case TYPE.plural:
        uses.set(el.value, false);
        for (const option of Object.values(el.options)) argumentUses(option.value, uses);
        break;
      case TYPE.tag:
        argumentUses(el.children, uses);
        break;
      default:
        break;
    }
  }
}

/**
 * A copy of `values` where a string is wrapped in `isolate` only when every use of its name in
 * `message` is a simple `{name}`; select, plural, selectordinal, number, date and time arguments
 * and non-strings pass unchanged. An unparseable message leaves every value unchanged.
 */
export function isolateSimpleArguments(
  message: string,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const uses = new Map<string, boolean>();
  try {
    argumentUses(parse(message), uses);
  } catch {
    return { ...values };
  }
  return simpleIsolated(uses, values);
}

/** The names `message` uses only as simple arguments (for callers that cache per message). */
export function simpleArgumentNames(message: string): ReadonlySet<string> {
  const uses = new Map<string, boolean>();
  try {
    argumentUses(parse(message), uses);
  } catch {
    return new Set();
  }
  return new Set([...uses].filter(([, simple]) => simple).map(([name]) => name));
}

function simpleIsolated(
  uses: ReadonlyMap<string, boolean>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string" && uses.get(name) === true ? isolate(value) : value,
    ]),
  );
}

/** As isolateSimpleArguments, with the simple names already known. */
export function isolateNamedArguments(
  simple: ReadonlySet<string>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string" && simple.has(name) ? isolate(value) : value,
    ]),
  );
}
