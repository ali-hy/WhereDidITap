// The privacy canary suite (LLD §10.1). TP-3.10: the baseline flow. An error carrying every canary
// in its message (including frame-shaped message lines, code review B-2), cause and properties goes
// through the logger (F-31), F-34's memory reporter and the real Sentry path (initSentry with a
// local fake Sentry, the reporter, Sentry.captureException and the unhandled-rejection
// integration), with canaries in the ErrorContext too; nothing captured contains a canary. Later
// slices add their flows to this directory (TP-4.9, TP-5.2, TP-6.7, TP-8.12, TP-9.11).
import { CANARIES, scanForCanaries, type Canaries } from "@budmon/test-support";
import * as Sentry from "@sentry/node";
import { describe, expect, it } from "vitest";
import {
  createMemoryErrorReporter,
  type ErrorContext,
} from "../../src/platform/observability/errorReporter.js";
import { createLogger } from "../../src/platform/observability/logger.js";
import type { SafeFields } from "../../src/platform/observability/safeFields.js";
import { initSentry } from "../../src/platform/observability/sentry.js";
import { sentryEvents, startFakeSentry } from "../support/fakeSentry.js";
import { logCapture } from "../support/telemetry.js";

/** A message whose extra lines look like stack frames and carry canaries (code review B-2). */
const FRAME_SHAPED_MESSAGE = `boom\n    at ${CANARIES.payee} (/app/${CANARIES.token}.js:1:2)\n    at ${CANARIES.message}`;

/** An ErrorContext carrying canaries where a caller might pass raw values. */
const CANARY_CONTEXT: ErrorContext = {
  requestId: "r1",
  route: `/v1/entries?token=${CANARIES.token}`,
  userId: CANARIES.email,
  errorKey: "CONFLICT",
};

function allCanaries(): string {
  return (Object.keys(CANARIES) as (keyof Canaries)[]).map((k) => CANARIES[k]).join(" ");
}

/** An error with every canary in its message, its cause chain and its own properties. */
function canaryError(): Error {
  const cause = Object.assign(new Error(`cause ${allCanaries()}`), {
    detail: allCanaries(),
    code: CANARIES.token,
  });
  const inner = new AggregateError([new Error(allCanaries())], `aggregate ${allCanaries()}`);
  return Object.assign(new Error(`${FRAME_SHAPED_MESSAGE}\nfailed: ${allCanaries()}`, { cause }), {
    ...CANARIES,
    detail: allCanaries(),
    where: allCanaries(),
    parameters: Object.values(CANARIES),
    config: { headers: { Authorization: `Bearer ${CANARIES.token}` }, data: allCanaries() },
    response: { status: 500, data: { error: { message: allCanaries() } } },
    errors: [inner],
  });
}

describe("TP-3.10: baseline canary flow", () => {
  it("TP-3.10: the logger and the reporter capture nothing that scanForCanaries finds", () => {
    const capture = logCapture();
    const logger = createLogger({
      service: "api",
      release: "v1.2.3",
      level: "debug",
      destination: capture,
    });
    const reporter = createMemoryErrorReporter();
    const err = canaryError();
    // A caller bypassing the types, with canaries in unknown and known-but-invalid fields.
    const fields = {
      payee: CANARIES.payee,
      email: CANARIES.email,
      userId: CANARIES.email,
      route: `/x?token=${CANARIES.token}`,
      reason: allCanaries(),
    } as unknown as SafeFields;

    logger.error("op_failed", fields, err);
    logger.warn("op_retry", fields, err);
    logger.child(fields).info("op_child", fields);
    reporter.report(err, { requestId: "r1", route: "/v1/entries/{id}", errorKey: "CONFLICT" });
    reporter.report(err, CANARY_CONTEXT);

    expect(capture.lines().length).toBeGreaterThanOrEqual(3);
    expect(reporter.events).toHaveLength(2);
    const hits = scanForCanaries(
      [
        { name: "logs", text: capture.text() },
        { name: "reporter", text: JSON.stringify(reporter.events) },
      ],
      CANARIES,
    );
    expect(hits).toEqual([]);
  });

  it("TP-3.10: the real Sentry path sends nothing that scanForCanaries finds", async () => {
    const sentry = await startFakeSentry();
    const listenersBefore = new Set(process.listeners("unhandledRejection"));
    try {
      const reporter = initSentry({
        dsn: sentry.dsn,
        environment: "test",
        release: "v1.2.3",
        service: "api",
      });
      const err = canaryError();

      reporter.report(err, CANARY_CONTEXT);
      Sentry.captureException(canaryError());
      // The unhandled-rejection integration's own listener, called directly: a real unhandled
      // rejection would also fail the test run.
      const added = process
        .listeners("unhandledRejection")
        .filter((listener) => !listenersBefore.has(listener));
      expect(added.length).toBeGreaterThan(0);
      for (const listener of added) listener(canaryError(), Promise.resolve());
      await reporter.flush(5_000);
      await Sentry.flush(5_000);

      expect(sentryEvents(sentry.bodies).length).toBeGreaterThanOrEqual(3);
      expect(
        scanForCanaries(
          sentry.bodies.map((text, i) => ({ name: `envelope ${String(i)}`, text })),
          CANARIES,
        ),
      ).toEqual([]);
    } finally {
      for (const listener of process.listeners("unhandledRejection")) {
        if (!listenersBefore.has(listener)) process.off("unhandledRejection", listener);
      }
      await Sentry.close(1_000);
      await sentry.close();
    }
  });
});
