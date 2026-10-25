// F-32 Secret. TP-3.3, plus extra cases TP-3.21x. IDs ending in "x" are test-architect additions,
// not LLD test-plan IDs. (Secret itself arrived early, in S-2, for the configuration.)
import { Console } from "node:console";
import { Writable } from "node:stream";
import { format, inspect } from "node:util";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { Secret } from "../../../src/platform/observability/redaction.js";

function noCanary(text: string): void {
  expect(scanForCanaries([{ name: "output", text }], CANARIES)).toEqual([]);
}

/** A Console writing into a string, as console.log would write to stdout. */
function capturedConsole(): { console: Console; text: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { console: new Console({ stdout: stream, stderr: stream }), text: () => text };
}

describe("TP-3.3: Secret", () => {
  it("TP-3.3: JSON.stringify shows [redacted], alone and inside an object", () => {
    const s = Secret.of(CANARIES.token);

    expect(JSON.stringify(s)).toBe('"[redacted]"');
    expect(JSON.stringify({ s })).toBe('{"s":"[redacted]"}');
  });

  it("TP-3.3: util.inspect of an object holding it shows [redacted]", () => {
    const text = inspect({ s: Secret.of(CANARIES.token) }, { depth: 10, showHidden: true });

    expect(text).toContain("[redacted]");
    noCanary(text);
  });

  it("TP-3.3: a template literal shows [redacted]", () => {
    const s = Secret.of(CANARIES.token);

    expect(`token=${String(s)}`).toBe("token=[redacted]");
  });

  it("TP-3.3: console.log of it, and of an object holding it, shows [redacted]", () => {
    const out = capturedConsole();
    const s = Secret.of(CANARIES.token);

    out.console.log(s);
    out.console.log({ nested: { s } });
    out.console.log("%s %o %O %j", s, { s }, { s }, { s });

    expect(out.text()).toContain("[redacted]");
    noCanary(out.text());
  });
});

describe("TP-3.21x: Secret, further cases (F-32)", () => {
  it("TP-3.21x: reveal returns the value", () => {
    expect(Secret.of(CANARIES.token).reveal()).toBe(CANARIES.token);
  });

  it("TP-3.21x: the value isn't an enumerable or own string property", () => {
    const s = Secret.of(CANARIES.token);

    expect(Object.keys(s)).toEqual([]);
    expect(Object.getOwnPropertyNames(s)).toEqual([]);
    noCanary(JSON.stringify(Object.entries(s)));
  });

  it("TP-3.21x: util.format and string concatenation show [redacted]", () => {
    const s = Secret.of(CANARIES.token);

    noCanary(format("%s|%o|%O|%j", s, s, s, s));
    expect(String(s)).toBe("[redacted]");
  });

  it("TP-3.21x: a Secret holding an object never shows the object", () => {
    const s = Secret.of({ password: CANARIES.token, nested: { email: CANARIES.email } });

    noCanary(JSON.stringify({ s }));
    noCanary(inspect({ s }, { depth: 10, showHidden: true }));
    expect(s.reveal().password).toBe(CANARIES.token);
  });
});
