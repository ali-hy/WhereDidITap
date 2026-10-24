// F-34 and F-35 with the real Sentry SDK (A-110, A-112, code review B-2). TP-3.14.
// The "test transport" is a local fake Sentry server (test/support/fakeSentry.ts); (b) and (c) run
// in child processes (test/fixtures/processes/sentryChild.ts), so a real uncaught exception and a
// real unhandled rejection reach Sentry's own integrations.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { initSentry } from "../../../src/platform/observability/sentry.js";
import { sentryEvents, startFakeSentry, type FakeSentry } from "../../support/fakeSentry.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");
const CHILD = path.join(SERVER_DIR, "test/fixtures/processes/sentryChild.ts");

// A-119: a space only after a leading "async " or "new ".
const FUNCTION_PATTERN = /^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_$.<>[\]]{0,99}$/;
const FILENAME_PATTERN = /^[A-Za-z0-9_@./<>:-]{1,200}$/;

function frameShapedErrors(): Error[] {
  return [
    new Error(`x\n    at ${CANARIES.payee} (/a.js:1:1)`),
    new Error(`    at f (${CANARIES.token}:1:1)`),
    new Error(
      `line one\n    at ${CANARIES.message} (${CANARIES.message}.js:2:3)\n    at ${CANARIES.message}\nlast`,
    ),
  ];
}

interface ExceptionValue {
  type?: unknown;
  value?: unknown;
  stacktrace?: { frames?: { function?: unknown; filename?: unknown }[] };
}

function exceptionValues(event: Record<string, unknown>): ExceptionValue[] {
  return (event["exception"] as { values?: ExceptionValue[] } | undefined)?.values ?? [];
}

/** Every exception value is buildErrorEvent's shape: class type, a code-like value, safe frames. */
function expectRebuilt(events: readonly Record<string, unknown>[]): void {
  for (const event of events) {
    for (const value of exceptionValues(event)) {
      expect(value.type).toBe("Error");
      expect(value.value).toBe("Error");
      for (const frame of value.stacktrace?.frames ?? []) {
        const { filename, function: fn } = frame;
        expect(
          typeof filename === "string" && FILENAME_PATTERN.test(filename),
          JSON.stringify(frame),
        ).toBe(true);
        expect(
          fn === undefined || (typeof fn === "string" && FUNCTION_PATTERN.test(fn)),
          JSON.stringify(frame),
        ).toBe(true);
      }
    }
  }
}

function noCanary(sentry: FakeSentry): void {
  expect(
    scanForCanaries(
      sentry.bodies.map((text, i) => ({ name: `envelope ${String(i)}`, text })),
      CANARIES,
    ),
  ).toEqual([]);
}

function runChild(mode: "uncaught" | "unhandled", dsn: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CHILD, mode], {
      cwd: SERVER_DIR,
      env: { PATH: process.env["PATH"] ?? "", SENTRY_DSN: dsn },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child ${mode} timed out`));
    }, 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

let servers: FakeSentry[] = [];

afterEach(async () => {
  await Sentry.close(1_000);
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function server(): Promise<FakeSentry> {
  const s = await startFakeSentry();
  servers.push(s);
  return s;
}

// A-141: the fake Sentry's local http DSN is accepted in development and test only.
const CFG = { environment: "test", release: "v1.2.3", service: "api" } as const;

describe("TP-3.14: the real Sentry SDK", () => {
  it("TP-3.14 (a): Sentry.captureException of the frame-shaped errors sends rebuilt values only", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    for (const err of frameShapedErrors()) Sentry.captureException(err);
    await reporter.flush(5_000);

    const events = sentryEvents(sentry.bodies);
    expect(events).toHaveLength(3);
    expectRebuilt(events);
    noCanary(sentry);
  });

  it.each([["uncaught" as const], ["unhandled" as const]])(
    "TP-3.14 (b, c): a child with an %s frame-shaped error sends one rebuilt event and no canary",
    async (mode) => {
      const sentry = await server();

      const code = await runChild(mode, sentry.dsn);

      expect(code).toBe(0);
      const events = sentryEvents(sentry.bodies);
      expect(events).toHaveLength(1);
      expectRebuilt(events);
      noCanary(sentry);
    },
    90_000,
  );

  it("TP-3.14 (d): report with a canary in every ErrorContext field sends none of them", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error(CANARIES.message), {
      requestId: `${CANARIES.token} x`,
      userId: CANARIES.email,
      route: `/x?token=${CANARIES.token}`,
      jobName: `${CANARIES.payee} x`,
      errorKey: `${CANARIES.message} x`,
    });
    // A-121: token-shaped canaries fail the tighter userId, jobName and requestId formats too.
    reporter.report(new Error(CANARIES.message), {
      userId: CANARIES.token,
      jobName: CANARIES.payee,
      requestId: CANARIES.payee,
    });
    await reporter.flush(5_000);

    const events = sentryEvents(sentry.bodies);
    expect(events).toHaveLength(2);
    const tags = (events[0]?.["tags"] ?? {}) as Record<string, unknown>;
    expect(tags["route"]).toBe("/x");
    for (const event of events) {
      expect((event["user"] as Record<string, unknown> | undefined)?.["id"]).toBeUndefined();
      expect((event["tags"] ?? {}) as Record<string, unknown>).not.toHaveProperty("job");
    }
    expect(tags).not.toHaveProperty("job");
    expect(tags).not.toHaveProperty("error_key");
    expect((events[0]?.["user"] as Record<string, unknown> | undefined)?.["id"]).toBeUndefined();
    expectRebuilt(events);
    noCanary(sentry);
  });
});
