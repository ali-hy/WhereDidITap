// F-39 startupState and installFatalHandlers (A-115, A-118, A-120). TP-3.16's A-115 part and
// TP-3.17 (a), plus extra cases TP-3.34x. TP-3.17 (b), with real child processes, is in
// integration/observability/fatalProcess.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { EventEmitter } from "node:events";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import type { ErrorReporter } from "../../../src/platform/observability/errorReporter.js";
import {
  installFatalHandlers,
  startupState,
  type FatalState,
} from "../../../src/platform/observability/fatal.js";
import { createLogger } from "../../../src/platform/observability/logger.js";
import { logCapture, type LogCapture } from "../../support/telemetry.js";

describe("TP-3.16: startupState's release (A-115)", () => {
  it.each([
    ["v1.2.3", "v1.2.3"],
    ["bad value\n", "dev"],
  ])("TP-3.16: BUDMON_RELEASE %j gives release %j", (value, release) => {
    const capture = logCapture();
    const state = startupState("api", { BUDMON_RELEASE: value }, { destination: capture });

    state.logger.info("startup_event");

    expect(capture.records()).toHaveLength(1);
    expect(capture.records()[0]).toMatchObject({ service: "api", release, event: "startup_event" });
    expect(capture.text()).not.toContain("bad value");
  });
});

describe("TP-3.34x: startupState, further cases (F-39)", () => {
  it.each([
    ["unset", undefined, "dev"],
    ["dev", "dev", "dev"],
    ["a hotfix release", "v1.2.3-hotfix.1", "v1.2.3-hotfix.1"],
    ["a token-shaped canary", CANARIES.token, "dev"],
  ])("TP-3.34x: BUDMON_RELEASE %s gives release %j", (_label, value, release) => {
    const capture = logCapture();
    const state = startupState("worker", { BUDMON_RELEASE: value }, { destination: capture });

    state.logger.info("startup_event");

    expect(capture.records()[0]).toMatchObject({ service: "worker", release });
  });

  it("TP-3.34x: the startup reporter does nothing and its flush resolves", async () => {
    const state = startupState("api", {}, { destination: logCapture() });

    expect(() => {
      state.reporter.report(new Error(CANARIES.message), {});
    }).not.toThrow();
    await expect(state.reporter.flush(10)).resolves.toBeUndefined();
  });
});

interface Harness {
  target: EventEmitter;
  state: FatalState;
  capture: LogCapture;
  calls: string[];
  exited: Promise<number>;
  exit: (code: number) => void;
}

function harness(flush: (timeoutMs: number) => Promise<void> = () => Promise.resolve()): Harness {
  const target = new EventEmitter();
  const capture = logCapture();
  const calls: string[] = [];
  const reporter: ErrorReporter = {
    report: () => undefined,
    flush: (timeoutMs) => {
      calls.push(`flush:${String(timeoutMs)}`);
      return flush(timeoutMs);
    },
  };
  const state: FatalState = {
    logger: createLogger({
      service: "api",
      release: "v1.2.3",
      level: "info",
      destination: capture,
    }),
    reporter,
  };
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const exit = (code: number): void => {
    calls.push(`exit:${String(code)}`);
    resolveExit(code);
  };
  installFatalHandlers(state, exit, target);
  return { target, state, capture, calls, exited, exit };
}

function noCanary(text: string): void {
  expect(scanForCanaries([{ name: "log", text }], CANARIES)).toEqual([]);
}

describe("TP-3.17 (a): installFatalHandlers", () => {
  it("TP-3.17 (a): an unhandled rejection logs one unhandled_rejection line, flushes, then exits 1", async () => {
    const h = harness();

    h.target.emit("unhandledRejection", new Error(CANARIES.message), Promise.resolve());

    expect(await h.exited).toBe(1);
    const lines = h.capture.records();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      event: "unhandled_rejection",
      errorClass: "Error",
    });
    expect(lines[0]).toHaveProperty("err");
    expect(h.calls).toEqual(["flush:2000", "exit:1"]);
    noCanary(h.capture.text());
  });

  it("TP-3.17 (a): an uncaught exception logs one uncaught_exception line, flushes, then exits 1", async () => {
    const h = harness();

    h.target.emit("uncaughtException", new Error(CANARIES.payee));

    expect(await h.exited).toBe(1);
    const lines = h.capture.records();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      event: "uncaught_exception",
      errorClass: "Error",
    });
    expect(h.calls).toEqual(["flush:2000", "exit:1"]);
    noCanary(h.capture.text());
  });

  it("TP-3.17 (a): a reporter whose flush rejects still ends in exit(1)", async () => {
    const h = harness(() => Promise.reject(new Error(CANARIES.token)));

    h.target.emit("uncaughtException", new Error(CANARIES.payee));

    expect(await h.exited).toBe(1);
    expect(h.calls).toEqual(["flush:2000", "exit:1"]);
    noCanary(h.capture.text());
  });
});

describe("TP-3.34x: installFatalHandlers, further cases (F-39)", () => {
  it("TP-3.34x: state is read at event time, so a replaced logger and reporter are used", async () => {
    const h = harness();
    const replacement = logCapture();
    const flushes: number[] = [];
    h.state.logger = createLogger({
      service: "api",
      release: "v2.0.0",
      level: "info",
      destination: replacement,
    });
    h.state.reporter = {
      report: () => undefined,
      flush: (t) => {
        flushes.push(t);
        return Promise.resolve();
      },
    };

    h.target.emit("unhandledRejection", new Error("m"), Promise.resolve());

    expect(await h.exited).toBe(1);
    expect(h.capture.lines()).toEqual([]);
    expect(replacement.records()[0]).toMatchObject({
      release: "v2.0.0",
      event: "unhandled_rejection",
    });
    expect(flushes).toEqual([2000]);
  });

  it("TP-3.34x: a rejection with a non-Error reason logs errorClass NonError and never the reason", async () => {
    const h = harness();

    h.target.emit("unhandledRejection", CANARIES.email, Promise.resolve());

    expect(await h.exited).toBe(1);
    expect(h.capture.records()[0]).toMatchObject({ errorClass: "NonError" });
    noCanary(h.capture.text());
  });

  it("TP-3.34x: nothing happens before an event", () => {
    const h = harness();

    expect(h.calls).toEqual([]);
    expect(h.capture.lines()).toEqual([]);
  });
});
