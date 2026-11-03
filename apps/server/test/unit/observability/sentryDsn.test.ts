// F-34 initSentry's DSN check (A-131, A-141). TP-3.18: an invalid DSN gives the no-op reporter,
// Sentry is never initialised, nothing is written to the console, stdout or stderr, and the key
// appears nowhere; the fake Sentry's local http DSN works in test and gives the no-op reporter in
// production.
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSentry } from "../../../src/platform/observability/sentry.js";
import { sentryEvents, startFakeSentry } from "../../support/fakeSentry.js";

const BAD_DSN = "https://pub:SECRETKEYabc@o1.ingest.sentry.io/";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TP-3.18: initSentry with an invalid DSN", () => {
  it("TP-3.18: returns the no-op reporter, doesn't initialise Sentry and writes nothing", async () => {
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(args.map(String).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    const reporter = initSentry({
      dsn: BAD_DSN,
      environment: "production",
      release: "v1.2.3",
      service: "api",
    });
    reporter.report(new Error("x"), {});
    await reporter.flush(100);
    vi.restoreAllMocks();

    expect(Sentry.getClient()).toBeUndefined();
    expect(written).toEqual([]);
    expect(JSON.stringify(reporter)).not.toContain("SECRETKEYabc");
  });
});

describe("TP-3.18: the local http DSN (A-141)", () => {
  it("TP-3.18: in test, events reach the fake Sentry", async () => {
    const sentry = await startFakeSentry();
    try {
      const reporter = initSentry({
        dsn: sentry.dsn,
        environment: "test",
        release: "v1.2.3",
        service: "api",
      });

      reporter.report(new Error("x"), {});
      await reporter.flush(5_000);

      expect(sentryEvents(sentry.bodies)).toHaveLength(1);
    } finally {
      await Sentry.close(1_000);
      await sentry.close();
    }
  });

  it("TP-3.18: in production, the same DSN gives the no-op reporter", async () => {
    const sentry = await startFakeSentry();
    try {
      const reporter = initSentry({
        dsn: sentry.dsn,
        environment: "production",
        release: "v1.2.3",
        service: "api",
      });

      reporter.report(new Error("x"), {});
      await reporter.flush(500);

      expect(sentry.bodies).toEqual([]);
    } finally {
      await sentry.close();
    }
  });
});
