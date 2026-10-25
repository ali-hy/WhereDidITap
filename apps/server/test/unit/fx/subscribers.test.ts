// F-132 rates-added subscribers. TP-9.15, plus extra cases TP-9.24x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// A-266: registerRatesAddedSubscriber checks the definition (role general, payload identical to
// RatesAddedPayload); F-96 checks registration in the job registry (TP-9.15 (c), fxService.test.ts).
import { fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../../src/platform/db/types.js";
import type { JobQueue } from "../../../src/platform/queue/jobQueue.js";
import { observed } from "../../support/api.js";
import { recordingLogger } from "../../support/platform.js";
import { createFxService, RatesAddedPayload } from "../../../src/platform/fx/fxService.js";

function service() {
  return createFxService({
    database: {} as Database,
    queue: {} as JobQueue,
    clock: fixedClock("2026-10-05T00:30:00Z"),
    logger: recordingLogger(),
    metrics: observed().metrics,
  });
}

function subscriber(role: "general" | "capture", payload: z.ZodType<RatesAddedPayload>) {
  return {
    name: "test.fx-rates-added",
    role,
    payload,
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: "standard" as const,
  };
}

describe("TP-9.15: subscriber validation (F-132)", () => {
  it("TP-9.15 (a): a subscriber with role capture throws TypeError", () => {
    const fx = service();

    expect(() => {
      fx.registerRatesAddedSubscriber(subscriber("capture", RatesAddedPayload));
    }).toThrow(TypeError);
    expect(fx.subscribers()).toEqual([]);
  });

  it("TP-9.24x: a general subscriber with RatesAddedPayload is stored and listed", () => {
    const fx = service();
    const def = subscriber("general", RatesAddedPayload);

    fx.registerRatesAddedSubscriber(def);

    expect(fx.subscribers()).toEqual([def]);
  });

  it("TP-9.15 (b): a general subscriber with an equivalent payload schema, not RatesAddedPayload, throws TypeError", () => {
    const fx = service();
    const other = z.object({
      rateDate: z.string(),
      affectedFrom: z.string(),
      affectedTo: z.string().nullable(),
    });

    expect(() => {
      fx.registerRatesAddedSubscriber(subscriber("general", other));
    }).toThrow(TypeError);
  });

  it("TP-9.24x: RatesAddedPayload takes {rateDate, affectedFrom, affectedTo} with affectedTo nullable", () => {
    expect(
      RatesAddedPayload.safeParse({
        rateDate: "2026-10-04",
        affectedFrom: "2026-10-04",
        affectedTo: null,
      }).success,
    ).toBe(true);
    expect(
      RatesAddedPayload.safeParse({
        rateDate: "2026-10-04",
        affectedFrom: "2026-10-04",
        affectedTo: "2026-10-06",
      }).success,
    ).toBe(true);
    expect(RatesAddedPayload.safeParse({ rateDate: "2026-10-04" }).success).toBe(false);
  });
});
