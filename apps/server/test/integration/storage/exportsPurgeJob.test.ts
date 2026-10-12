// F-80's platform.exports-purge (A-215): registered with F-144's handler in S-10. TP-10.12 (A-357,
// A-358), plus extra cases TP-10.13x (the LLD tests F-144 itself in TP-10.5). IDs ending in "x" are test-architect
// additions, not LLD test-plan IDs.
import { Temporal, fixedClock } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import { platformMaintenanceJobs } from "../../../src/platform/maintenance/maintenanceJobs.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { buildWorkerContainer } from "../../support/worker.js";
import { createMemoryObjectStore } from "../../../src/platform/storage/memoryObjectStore.js";
import { ObjectStoreError } from "../../../src/platform/storage/objectStore.js";
import { wrapHandler } from "../../../src/platform/queue/wrapper.js";
import { exportKey, keysOf } from "../../support/s10.js";

describe("TP-10.13x: platform.exports-purge (F-80, A-215)", () => {
  it("TP-10.13x: the definition is general, cron 15 * * * *, with an empty payload", () => {
    const def = platformMaintenanceJobs.find((d) => d.name === "platform.exports-purge");

    expect(def).toMatchObject({ role: "general", cron: "15 * * * *" });
    expect(def?.payload.safeParse({}).success).toBe(true);
  });

  it("TP-10.13x: the general worker's handler purges exports older than 7 days from its objectStore", async () => {
    const clock = fixedClock("2026-09-29T12:00:00Z");
    const store = createMemoryObjectStore(clock);
    const old = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000008");
    const recent = exportKey("0190a0b0-1c2d-7e3f-8a4b-000000000006");
    await store.put("exports", old, Buffer.from("old"), "application/zip");
    clock.advance({ hours: 2 * 24 });
    await store.put("exports", recent, Buffer.from("recent"), "application/zip");
    clock.advance({ hours: 6 * 24 });
    const built = await buildWorkerContainer("general", {
      clock,
      ...({ objectStore: store } as object),
    });
    try {
      const handler = buildHandlerMap(built.container).get("platform.exports-purge");
      expect(handler).toBeDefined();

      await handler?.(
        {},
        {
          jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          attempt: 1,
          createdOn: Temporal.Instant.from("2026-10-07T12:00:00Z"),
          logger: built.container.logger,
          signal: new AbortController().signal,
        },
      );

      expect(await keysOf(store, "exports", "users/")).toEqual([recent]);
      expect(built.obs.capture.records().filter((l) => l["event"] === "exports_purged")).toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
    } finally {
      await built.close();
    }
  });
});

// A-358: maintenance jobs retry once, slowly; A-357: an ObjectStoreError's reason reaches job_failed.
describe("TP-10.12: maintenance retries and object-store failure reasons (F-80, F-26)", () => {
  it.each(platformMaintenanceJobs.map((d) => [d.name, d] as const))(
    "TP-10.12 (A-358): %s has retryLimit 1, retryDelaySeconds 300, retryBackoff false",
    (_name, def) => {
      expect({
        retryLimit: def.retryLimit,
        retryDelaySeconds: def.retryDelaySeconds,
        retryBackoff: def.retryBackoff,
      }).toEqual({ retryLimit: 1, retryDelaySeconds: 300, retryBackoff: false });
    },
  );

  it('TP-10.12 (A-357): exports-purge on a store whose list throws ObjectStoreError("unavailable") logs job_failed with errorClass ObjectStoreError and reason unavailable', async () => {
    const clock = fixedClock("2026-10-07T12:00:00Z");
    const store = createMemoryObjectStore(clock);
    const failing = {
      ...store,
      list: async function* () {
        await Promise.resolve();
        throw new ObjectStoreError("unavailable");
      },
    };
    const built = await buildWorkerContainer("general", {
      clock,
      ...({ objectStore: failing } as object),
    });
    try {
      const def = platformMaintenanceJobs.find((d) => d.name === "platform.exports-purge");
      const handler = buildHandlerMap(built.container).get("platform.exports-purge");
      if (def === undefined || handler === undefined) throw new Error("no exports-purge");
      const run = wrapHandler(def, handler, {
        logger: built.container.logger,
        metrics: built.container.metrics,
        reporter: built.container.reporter,
        clock,
      });

      await run([
        {
          id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          name: def.name,
          data: {},
          retryCount: 0,
          createdOn: new Date("2026-10-07T12:00:00Z"),
        } as unknown as Parameters<typeof run>[0][number],
      ]);

      const failed = built.obs.capture.records().filter((l) => l["event"] === "job_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ errorClass: "ObjectStoreError", reason: "unavailable" });
    } finally {
      await built.close();
    }
  });
});
