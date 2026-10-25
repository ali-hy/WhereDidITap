// F-33 frames and buildErrorEvent (A-110, code review B-2). TP-3.13, plus extra cases TP-3.31x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Each error goes through sanitizeError, buildErrorEvent, the logger (as `err`) and the memory
// reporter; no canary may appear in any of them.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { parse as parseConnectionString } from "pg-connection-string";
import { describe, expect, it } from "vitest";
import { createMemoryErrorReporter } from "../../../src/platform/observability/errorReporter.js";
import { createLogger } from "../../../src/platform/observability/logger.js";
import { buildErrorEvent, sanitizeError } from "../../../src/platform/observability/sanitize.js";
import { logCapture } from "../../support/telemetry.js";

const THIS_FILE = "apps/server/test/unit/observability/frames.test.ts";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** A-110's patterns for a kept frame (function tightened by A-119). */
// A-119: a space only after a leading "async " or "new ".
const FUNCTION_PATTERN = /^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_$.<>[\]]{0,99}$/;
const FILENAME_PATTERN = /^[A-Za-z0-9_@./<>:-]{1,200}$/;

function frameShapedErrors(): [string, Error][] {
  return [
    ["a payee frame after a first line", new Error(`x\n    at ${CANARIES.payee} (/a.js:1:1)`)],
    ["a token location as the first line", new Error(`    at f (${CANARIES.token}:1:1)`)],
    [
      "multi-line text with the message canary in frame shape",
      new Error(
        `line one\n    at ${CANARIES.message} (${CANARIES.message}.js:2:3)\n    at ${CANARIES.message}\nlast`,
      ),
    ],
  ];
}

function customStackError(): Error {
  const err = new Error(CANARIES.message);
  err.stack = `custom ${CANARIES.payee}\n    at good (${REPO_ROOT}/apps/server/a.js:1:1)`;
  return err;
}

function throwingToStringError(): Error {
  const err = new Error("m");
  Object.defineProperty(err, "toString", {
    value: () => {
      throw new Error(CANARIES.token);
    },
  });
  return err;
}

function repositoryError(): Error {
  return new Error("thrown here");
}

function nodeModulesError(): Error {
  try {
    parseConnectionString("postgres://u:p@[bad/postgres");
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected pg-connection-string to throw");
}

/** Every output TP-3.13 inspects for one error, as text. */
function outputs(err: unknown): { name: string; text: string }[] {
  const capture = logCapture();
  const logger = createLogger({
    service: "api",
    release: "v1.2.3",
    level: "debug",
    destination: capture,
  });
  logger.error("op_failed", {}, err);
  const reporter = createMemoryErrorReporter();
  reporter.report(err, {});
  return [
    { name: "frames", text: JSON.stringify(sanitizeError(err).frames) },
    { name: "sanitizeError", text: JSON.stringify(sanitizeError(err)) },
    { name: "buildErrorEvent", text: JSON.stringify(buildErrorEvent(err)) },
    { name: "log", text: capture.text() },
    { name: "reporter", text: JSON.stringify(reporter.events) },
  ];
}

describe("TP-3.13: frame-shaped messages never become frames", () => {
  it.each(frameShapedErrors())("TP-3.13: %s: no canary in any output", (_label, err) => {
    expect(scanForCanaries(outputs(err), CANARIES)).toEqual([]);
  });

  it("TP-3.13: a replaced (custom) stack gives frames: []", () => {
    const err = customStackError();

    expect(sanitizeError(err).frames).toEqual([]);
    expect(buildErrorEvent(err).stacktrace.frames).toEqual([]);
    expect(scanForCanaries(outputs(err), CANARIES)).toEqual([]);
  });

  it("TP-3.13: an error whose toString throws gives frames: []", () => {
    const err = throwingToStringError();

    expect(sanitizeError(err).frames).toEqual([]);
    expect(buildErrorEvent(err).stacktrace.frames).toEqual([]);
    expect(scanForCanaries(outputs(err), CANARIES)).toEqual([]);
  });
});

describe("TP-3.13: normal frames are kept with reduced filenames", () => {
  it("TP-3.13: an error thrown from a repository file keeps it repository-relative", () => {
    const frames = sanitizeError(repositoryError()).frames;

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toMatch(
      new RegExp(`^at repositoryError \\(${THIS_FILE.replaceAll(".", "\\.")}:\\d+:\\d+\\)$`),
    );
  });

  it("TP-3.13: an error from node_modules keeps the node_modules/… part", () => {
    const frames = sanitizeError(nodeModulesError()).frames;

    expect(
      frames.some((f) => /\(node_modules\/.*pg-connection-string\/.*:\d+:\d+\)$/.test(f)),
    ).toBe(true);
  });

  it.each([
    ["repository", repositoryError],
    ["node_modules", nodeModulesError],
  ])("TP-3.13: the %s error's frames never hold an absolute path", (_label, make) => {
    const err = make();

    for (const frame of sanitizeError(err).frames) {
      expect(frame).not.toContain(REPO_ROOT);
      expect(frame).not.toMatch(/\(\//);
    }
    for (const frame of buildErrorEvent(err).stacktrace.frames) {
      expect(frame.filename.startsWith("/")).toBe(false);
      expect(frame.filename).toMatch(FILENAME_PATTERN);
      if (frame.function !== undefined) expect(frame.function).toMatch(FUNCTION_PATTERN);
    }
  });
});

describe("TP-3.31x: buildErrorEvent, further cases (A-110)", () => {
  it("TP-3.31x: type is the class, value the key, code or class, frames innermost last", () => {
    const err = Object.assign(repositoryError(), { code: "ECONNRESET" });

    const event = buildErrorEvent(err);

    expect(event.type).toBe("Error");
    expect(event.value).toBe("ECONNRESET");
    const innermost = event.stacktrace.frames.at(-1);
    expect(innermost?.filename).toBe(THIS_FILE);
    expect(innermost?.function).toBe("repositoryError");
    expect(typeof innermost?.lineno).toBe("number");
    expect(typeof innermost?.colno).toBe("number");
  });

  it("TP-3.31x: a non-Error is a NonError with no frames", () => {
    expect(buildErrorEvent(CANARIES.message)).toEqual({
      type: "NonError",
      value: "NonError",
      stacktrace: { frames: [] },
    });
  });

  it("TP-3.31x: frames from outside the repository and node_modules get filename <unknown>", () => {
    const err = new Error("m");
    err.stack = `Error: m\n    at outside (/home/u/secret/x.js:3:4)\n    at node:internal/timers:5:6`;

    const event = buildErrorEvent(err);

    expect(event.stacktrace.frames.map((f) => f.filename)).toContain("<unknown>");
    expect(JSON.stringify(event)).not.toContain("/home/u/secret");
  });

  it("TP-3.31x: V8 names with async, new and <anonymous> are kept; other names with a space are dropped (A-119)", () => {
    const err = new Error("m");
    err.stack = [
      "Error: m",
      `    at Object.<anonymous> (${REPO_ROOT}/apps/server/a.js:1:2)`,
      `    at async run (${REPO_ROOT}/apps/server/b.js:3:4)`,
      `    at new Client (${REPO_ROOT}/node_modules/pg/lib/client.js:5:6)`,
      `    at weird name (${REPO_ROOT}/apps/server/c.js:7:8)`,
      `    at x ${CANARIES.payee} y (${REPO_ROOT}/apps/server/d.js:9:9)`,
    ].join("\n");

    expect(sanitizeError(err).frames).toEqual([
      "at Object.<anonymous> (apps/server/a.js:1:2)",
      "at async run (apps/server/b.js:3:4)",
      "at new Client (node_modules/pg/lib/client.js:5:6)",
    ]);
  });
});
