// F-34 initSentry and ErrorReporter. TP-3.6, plus extra cases TP-3.25x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// The "Sentry test transport" is a local HTTP server: the DSN points at it, so the real Sentry
// client sends its envelopes there and the test reads exactly what would leave the process.
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { initSentry } from "../../../src/platform/observability/sentry.js";
import {
  sentryEvents as eventsOf,
  startFakeSentry as fakeSentry,
  type FakeSentry,
} from "../../support/fakeSentry.js";

let servers: FakeSentry[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function server(): Promise<FakeSentry> {
  const s = await fakeSentry();
  servers.push(s);
  return s;
}

// A-141: the fake Sentry's local http DSN is accepted in development and test only.
const CFG = { environment: "test", release: "v1.2.3", service: "api" } as const;

describe("TP-3.6: ErrorReporter through Sentry", () => {
  it("TP-3.6: report sends one event with type Error and value Error, and no canary anywhere", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error(CANARIES.message), { requestId: "r1" });
    await reporter.flush(5_000);

    const events = eventsOf(sentry.bodies);
    expect(events).toHaveLength(1);
    const exception = (events[0]?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "Error", value: "Error" });
    expect(
      scanForCanaries(
        sentry.bodies.map((text, i) => ({ name: `envelope ${String(i)}`, text })),
        CANARIES,
      ),
    ).toEqual([]);
  });

  it("TP-3.6: without a DSN, report is a no-op", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG });

    expect(() => {
      reporter.report(new Error(CANARIES.message), { requestId: "r1" });
    }).not.toThrow();
    await reporter.flush(500);

    expect(sentry.bodies).toEqual([]);
  });
});

describe("TP-3.6: ErrorContext values are validated before use (A-112)", () => {
  it("TP-3.6: route keeps its path only; userId, jobName and errorKey that fail their rules are dropped", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error(CANARIES.message), {
      route: `/x?token=${CANARIES.token}`,
      userId: CANARIES.email,
      jobName: `${CANARIES.payee} x`,
      errorKey: "bad key",
    });
    await reporter.flush(5_000);

    const events = eventsOf(sentry.bodies);
    expect(events).toHaveLength(1);
    const tags = (events[0]?.["tags"] ?? {}) as Record<string, unknown>;
    expect(tags["route"]).toBe("/x");
    expect(tags).not.toHaveProperty("job");
    expect(tags).not.toHaveProperty("error_key");
    expect((events[0]?.["user"] as Record<string, unknown> | undefined)?.["id"]).toBeUndefined();
    expect(
      scanForCanaries([{ name: "envelope", text: sentry.bodies.join("\n") }], CANARIES),
    ).toEqual([]);
  });
});

describe("TP-3.6: token-shaped canaries in ErrorContext are dropped, valid values kept (A-121)", () => {
  const VALID = {
    userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    jobName: "platform.fx-rates-fetch",
    requestId: "0123456789abcdef0123456789abcdef",
  };

  it("TP-3.6: userId, jobName and requestId holding token-shaped canaries are dropped", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error(CANARIES.message), {
      userId: CANARIES.token,
      jobName: CANARIES.payee,
      requestId: CANARIES.payee,
    });
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect((event?.["user"] as Record<string, unknown> | undefined)?.["id"]).toBeUndefined();
    expect((event?.["tags"] ?? {}) as Record<string, unknown>).not.toHaveProperty("job");
    expect((event?.["tags"] ?? {}) as Record<string, unknown>).not.toHaveProperty("request_id");
    expect(
      scanForCanaries([{ name: "envelope", text: sentry.bodies.join("\n") }], CANARIES),
    ).toEqual([]);
  });

  it("TP-3.6: a UUID userId, a job-name jobName and a 32-hex requestId give user.id, the job tag and the request_id tag (A-122)", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error("x"), VALID);
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect(event?.["user"]).toEqual({ id: VALID.userId });
    expect((event?.["tags"] ?? {}) as Record<string, unknown>).toMatchObject({
      job: VALID.jobName,
    });
    expect((event?.["tags"] ?? {}) as Record<string, unknown>).toMatchObject({
      request_id: VALID.requestId,
    });
  });
});

describe("TP-3.6: error_code and http_status tags (A-137)", () => {
  it("TP-3.6: a pg error with code 23505 is tagged error_code 23505", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(Object.assign(new Error(CANARIES.message), { code: "23505" }), {});
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect((event?.["tags"] ?? {}) as Record<string, unknown>).toMatchObject({
      error_code: "23505",
    });
  });

  it("TP-3.6: an error with status 403 is tagged http_status 403", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(Object.assign(new Error(CANARIES.message), { status: 403 }), {});
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect(String(((event?.["tags"] ?? {}) as Record<string, unknown>)["http_status"])).toBe("403");
  });
});

describe("TP-3.25x: ErrorReporter, further cases (F-34)", () => {
  it("TP-3.25x: the event carries the context as tags route, job, error_key and user.id, never the canary", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });
    const err = Object.assign(new Error(CANARIES.message, { cause: new Error(CANARIES.token) }), {
      code: "ECONNREFUSED",
      detail: CANARIES.payee,
    });

    reporter.report(err, {
      requestId: "0123456789abcdef0123456789abcdef",
      userId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
      route: "/v1/entries/{id}",
      jobName: "platform.fx-rates-fetch",
      errorKey: "SERVICE_UNAVAILABLE",
    });
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    expect(event?.["tags"]).toMatchObject({
      route: "/v1/entries/{id}",
      job: "platform.fx-rates-fetch",
      error_key: "SERVICE_UNAVAILABLE",
    });
    expect(event?.["user"]).toEqual({ id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b" });
    const exception = (event?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "Error", value: "ECONNREFUSED" });
    expect(
      scanForCanaries([{ name: "envelope", text: sentry.bodies.join("\n") }], CANARIES),
    ).toEqual([]);
  });

  it("TP-3.25x: the event's environment and release come from the configuration", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(new Error("x"), {});
    await reporter.flush(5_000);

    expect(eventsOf(sentry.bodies)[0]).toMatchObject({
      environment: "test",
      release: "v1.2.3",
    });
  });

  it("TP-3.25x: a thrown string is reported as NonError", async () => {
    const sentry = await server();
    const reporter = initSentry({ ...CFG, dsn: sentry.dsn });

    reporter.report(CANARIES.message, {});
    await reporter.flush(5_000);

    const [event] = eventsOf(sentry.bodies);
    const exception = (event?.["exception"] as { values: Record<string, unknown>[] }).values[0];
    expect(exception).toMatchObject({ type: "NonError", value: "NonError" });
    expect(sentry.bodies.join("\n")).not.toContain(CANARIES.message);
  });
});
