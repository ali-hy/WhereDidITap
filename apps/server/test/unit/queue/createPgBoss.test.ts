// F-77 createPgBoss's per-mode logins, pools and instance registration (A-218, A-299, review B-2).
// Extra cases TP-6.23x (test-architect additions, not LLD test-plan IDs). pg-boss is replaced by a
// recording constructor, so the options it would get are read directly.
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import { createPgBoss } from "../../../src/platform/queue/workers.js";
import { devWorker, readFileFrom } from "../../support/configEnv.js";

const recorded = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("pg-boss", () => ({
  PgBoss: vi.fn(function (this: { on: () => void }, options: Record<string, unknown>) {
    recorded.push(options);
    this.on = () => undefined;
  }),
}));

function workerConfig(roles: string, dbUser: string) {
  const f = devWorker();
  f.env["WORKER_ROLES"] = roles;
  f.env["DB_USER"] = dbUser;
  f.env["QUEUE_DB_USER"] = "budmon_queue";
  f.env["QUEUE_POOL_MAX"] = "7";
  return loadConfig("worker", f.env, readFileFrom(f.files));
}

function optionsFor(roles: string, dbUser: string, mode: "capture" | "general" | "cli") {
  recorded.length = 0;
  createPgBoss(workerConfig(roles, dbUser), mode);
  expect(recorded).toHaveLength(1);
  return recorded[0] ?? {};
}

describe("TP-6.23x: createPgBoss options per mode (F-77, A-299, review B-2)", () => {
  it("TP-6.23x (B-2): the capture instance of a combined worker uses the queue login with a pool max of 3 and doesn't register", () => {
    expect(optionsFor("capture,general", "budmon_app", "capture")).toMatchObject({
      user: "budmon_queue",
      max: 3,
      registerInstance: false,
    });
  });

  it("TP-6.23x: a capture-only worker's instance uses budmon_capture, a pool max of 3, and doesn't register", () => {
    expect(optionsFor("capture", "budmon_capture", "capture")).toMatchObject({
      user: "budmon_capture",
      max: 3,
      registerInstance: false,
    });
  });

  it("TP-6.23x: the general instance uses the queue login with QUEUE_POOL_MAX and registers", () => {
    expect(optionsFor("capture,general", "budmon_app", "general")).toMatchObject({
      user: "budmon_queue",
      max: 7,
      registerInstance: true,
    });
  });
});
