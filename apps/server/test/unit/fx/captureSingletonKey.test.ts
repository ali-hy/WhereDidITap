// F-71 and A-283's captureSingletonKeyField. TP-9.22 (f), plus extra cases TP-9.24x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fxBackfillJob } from "../../../src/platform/fx/fxJobs.js";
import { defineJob } from "../../../src/platform/queue/jobs.js";
import { createJobRegistry } from "../../../src/platform/queue/registry.js";

describe("TP-9.22 (f): captureSingletonKeyField needs sendableFromCapture (F-71, A-283)", () => {
  it("TP-9.22 (f): createJobRegistry throws TypeError for captureSingletonKeyField without sendableFromCapture", () => {
    const def = defineJob({
      name: "test.keyed",
      role: "general",
      payload: z.object({ rateDate: z.string() }),
      captureSingletonKeyField: "rateDate",
    });

    expect(() => createJobRegistry([def])).toThrow(TypeError);
  });

  it("TP-9.24x: with sendableFromCapture the registry accepts it", () => {
    const def = defineJob({
      name: "test.keyed",
      role: "general",
      payload: z.object({ rateDate: z.string() }),
      sendableFromCapture: true,
      captureSingletonKeyField: "rateDate",
    });

    expect(createJobRegistry([def]).get("test.keyed")).toBe(def);
  });

  it("TP-9.24x: platform.fx-backfill is sendable from capture with captureSingletonKeyField rateDate (A-275, A-283)", () => {
    expect(fxBackfillJob.sendableFromCapture).toBe(true);
    expect(fxBackfillJob.captureSingletonKeyField).toBe("rateDate");
  });
});
