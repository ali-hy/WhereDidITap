// Test fixture (A-201), owned by the test-architect: the built worker with test jobs.
//
// Spawned as `node --import ./dist/main/instrument.js test/fixtures/bundle/worker.mjs` from
// apps/server: F-89 strips `.mjs`, so this process gets worker telemetry. It imports runWorker
// from the bundle (importing doesn't run worker.js's entry guard) and passes the test registry
// and handlers for TP-6.13 and TP-6.15. The test.* queues exist in every template copy (A-202).
// Each run's HEARTBEAT_FILE (A-226) comes from the test's environment.
import { readFileSync } from "node:fs";
import pg from "pg";
import { z } from "zod";
import { runWorker } from "../../../dist/main/worker.js";

function job(name, retryLimit = 0) {
  return {
    name,
    role: "general",
    payload: z.object({ n: z.number().int() }),
    retryLimit,
    retryDelaySeconds: retryLimit === 0 ? 30 : 0,
    retryBackoff: false,
    expireInSeconds: 900,
    policy: "standard",
  };
}

const definitions = [
  job("test.slow"),
  job("test.forever"),
  job("test.select"),
  // TP-6.15 (A-237): a job lifecycle; retry limits match the template's test.* queues.
  job("test.ok"),
  job("test.fail", 1),
  job("test.fail3", 2),
];

const registry = {
  all: () => definitions,
  forRole: (role) => definitions.filter((d) => d.role === role),
  get: (name) => definitions.find((d) => d.name === name),
  deadLetterQueue: (role) => `dead-letter.${role}`,
};

const handlers = new Map([
  // TP-6.15 (A-237): completes; fails once then completes on its retry; always fails (dead-letter).
  ["test.ok", () => Promise.resolve()],
  [
    "test.fail3",
    (_payload, ctx) =>
      ctx.attempt === 1 ? Promise.reject(new Error("first try")) : Promise.resolve(),
  ],
  ["test.fail", () => Promise.reject(new Error("always"))],
  // TP-6.13: a 2 s job.
  ["test.slow", () => new Promise((resolve) => setTimeout(resolve, 2000))],
  // TP-6.13 (A-180): a job that never finishes.
  ["test.forever", () => new Promise(() => undefined)],
  // TP-6.15: SELECT 1 on a connection of its own, inside the job's span.
  [
    "test.select",
    async () => {
      const client = new pg.Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: readFileSync(process.env.DB_PASSWORD_FILE, "utf8").trim(),
      });
      await client.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        await client.end();
      }
    },
  ],
]);

await runWorker(process.env, { registry, handlers });
