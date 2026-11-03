// F-78b runGeneralStartHooks (A-26). TP-6.14's unit part (createWorkerContainer's defaults are in
// test/integration/queue/workers.test.ts).
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it, vi } from "vitest";
import { createMemoryErrorReporter } from "../../../src/platform/observability/errorReporter.js";
import { createLogger } from "../../../src/platform/observability/logger.js";
import { type WorkerRole } from "../../support/jobs.js";
import { logCapture } from "../../support/telemetry.js";
import { runGeneralStartHooks } from "../../../src/platform/queue/workers.js";

function deps(roles: readonly WorkerRole[], hooks: (() => Promise<void>)[]) {
  const capture = logCapture();
  const reporter = createMemoryErrorReporter();
  return {
    capture,
    reporter,
    c: {
      roles: new Set(roles),
      onGeneralStarted: hooks,
      logger: createLogger({
        service: "worker-general",
        release: "dev",
        level: "debug",
        destination: capture,
      }),
      reporter,
    },
  };
}

describe("TP-6.14: runGeneralStartHooks (F-78b, A-26)", () => {
  it("TP-6.14: roles {general} and [h1, h2]: h1 then h2, each once", async () => {
    const order: string[] = [];
    const h1 = vi.fn(() => {
      order.push("h1");
      return Promise.resolve();
    });
    const h2 = vi.fn(() => {
      order.push("h2");
      return Promise.resolve();
    });

    await runGeneralStartHooks(deps(["general"], [h1, h2]).c);

    expect(order).toEqual(["h1", "h2"]);
    expect([h1.mock.calls.length, h2.mock.calls.length]).toEqual([1, 1]);
  });

  it("TP-6.14: roles {capture} and [h1]: no hook is called", async () => {
    const h1 = vi.fn(() => Promise.resolve());

    await runGeneralStartHooks(deps(["capture"], [h1]).c);

    expect(h1).not.toHaveBeenCalled();
  });

  it("TP-6.14: h1 rejecting with a canary: h2 still runs, one report, one worker_start_hook_failed line with step onGeneralStarted:0, no canary, resolves", async () => {
    const h1 = vi.fn(() => Promise.reject(new Error(CANARIES.message)));
    const h2 = vi.fn(() => Promise.resolve());
    const d = deps(["general"], [h1, h2]);

    await expect(runGeneralStartHooks(d.c)).resolves.toBeUndefined();

    expect(h2).toHaveBeenCalledTimes(1);
    expect(d.reporter.events).toHaveLength(1);
    const lines = d.capture.records().filter((l) => l["event"] === "worker_start_hook_failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", step: "onGeneralStarted:0" });
    expect(
      scanForCanaries(
        [
          { name: "log", text: d.capture.text() },
          { name: "report", text: JSON.stringify(d.reporter.events) },
        ],
        CANARIES,
      ),
    ).toEqual([]);
  });

  it("TP-6.14: with both roles the hooks run; with no hooks it resolves", async () => {
    const h1 = vi.fn(() => Promise.resolve());

    await runGeneralStartHooks(deps(["capture", "general"], [h1]).c);
    await expect(runGeneralStartHooks(deps(["general"], []).c)).resolves.toBeUndefined();

    expect(h1).toHaveBeenCalledTimes(1);
  });
});
