// F-57 health routes and checkReadiness. TP-4.13, plus extra cases TP-4.42x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// (c) runs over HTTP with the journal injected through createApiServer's opts.journal (A-125) and
// a production configuration. The container connects as budmon_app, like the real API (A-130);
// the database has been through the schema step in migrate mode (A-146).
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { checkReadiness } from "../../../src/platform/http/health.js";
import { createApiServer } from "../../../src/platform/http/server.js";
import { buildApiContainer, injectJson, type BuiltContainer } from "../../support/api.js";
import { prodApi } from "../../support/configEnv.js";
import path from "node:path";
import { runSchemaStep } from "../../../src/platform/db/schemaStep.js";
import {
  SERVER_DIR,
  connectDatabase,
  recordingLogger,
  schemaStepInput,
} from "../../support/platform.js";
import { TEST_ROLE_PASSWORDS } from "../../support/postgres.js";

const EMPTY_JOURNAL = path.join(SERVER_DIR, "test/fixtures/migrations-empty");
const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function serve(built: BuiltContainer): Promise<FastifyInstance> {
  const app = await createApiServer(built.container);
  cleanups.push(
    () => built.close(),
    () => app.close(),
  );
  await app.ready();
  return app;
}

function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

describe("TP-4.13 (a): database up", () => {
  it("TP-4.13 (a): /health/ready is 200 ready and /health/live 200 ok, both no-store", async () => {
    const app = await serve(await buildApiContainer());

    const ready = await injectJson(app, "GET", "/health/ready");
    const live = await injectJson(app, "GET", "/health/live");

    expect([ready.status, ready.json()]).toEqual([200, { status: "ready" }]);
    expect([live.status, live.json()]).toEqual([200, { status: "ok" }]);
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect(live.headers["cache-control"]).toBe("no-store");
  });
});

describe("TP-4.13 (b): the pool points at a closed port", () => {
  it("TP-4.13 (b): /health/ready is 503 database_unreachable; /health/live stays 200", async () => {
    const port = await closedPort();
    const unreachable = connectDatabase(
      { host: "127.0.0.1", port },
      "budmon_app",
      TEST_ROLE_PASSWORDS.budmon_app,
      "budmon",
    );
    const built = await buildApiContainer({ database: unreachable });
    const app = await serve(built);

    const ready = await injectJson(app, "GET", "/health/ready");
    const live = await injectJson(app, "GET", "/health/live");

    expect([ready.status, ready.json()]).toEqual([
      503,
      { status: "not_ready", reason: "database_unreachable" },
    ]);
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect([live.status, live.json()]).toEqual([200, { status: "ok" }]);
  }, 30_000);
});

/**
 * A production api container connected as budmon_app, on a database the schema step has run on in
 * migrate mode with an empty journal (schema drizzle, its table and F-16's grant, A-130, A-146),
 * with the recorded migrations given.
 */
async function migratedProductionContainer(
  recorded: readonly string[] = ["h0"],
): Promise<BuiltContainer> {
  const built = await buildApiContainer({}, {}, prodApi);
  cleanups.push(() => built.close());
  const migrator = built.testDb.connectAs("budmon_migrator");
  try {
    await runSchemaStep(schemaStepInput(migrator, "migrate", recordingLogger(), EMPTY_JOURNAL));
    for (const hash of recorded) {
      await migrator.handle.executeSql(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, 1760000000000)",
        [hash],
      );
    }
  } finally {
    await migrator.close();
  }
  return built;
}

describe("TP-4.13 (c): production with the journal one entry ahead of the database", () => {
  it("TP-4.13 (c): /health/ready is 503 schema_behind; /health/live stays 200", async () => {
    const built = await migratedProductionContainer();
    const app = await createApiServer(built.container, {
      journal: [
        { hash: "h0", when: 1760000000000 },
        { hash: "h1", when: 1760000100000 },
      ],
    });
    cleanups.push(() => app.close());

    const ready = await injectJson(app, "GET", "/health/ready");
    const live = await injectJson(app, "GET", "/health/live");

    expect([ready.status, ready.json()]).toEqual([
      503,
      { status: "not_ready", reason: "schema_behind" },
    ]);
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect([live.status, live.json()]).toEqual([200, { status: "ok" }]);
  });

  it("TP-4.42x: the same database with the journal equal to it is ready", async () => {
    const built = await migratedProductionContainer();

    const result = await checkReadiness({
      db: built.container.database,
      appEnv: "production",
      journal: [{ hash: "h0", when: 1760000000000 }],
    });

    expect(result).toEqual({ ready: true });
  });
});

describe("TP-4.13 (d): production, migrate mode, an empty table and an empty journal (A-146)", () => {
  it("TP-4.13 (d): /health/ready is 200 ready", async () => {
    const built = await migratedProductionContainer([]);
    const app = await createApiServer(built.container, { journal: [] });
    cleanups.push(() => app.close());

    const ready = await injectJson(app, "GET", "/health/ready");

    expect([ready.status, ready.json()]).toEqual([200, { status: "ready" }]);
    expect(ready.headers["cache-control"]).toBe("no-store");
  });
});

describe("TP-4.13: the auth hook doesn't run for /health/* (A-154)", () => {
  it("TP-4.13: with an auth hook that throws, /health/live and /health/ready are 200 and the hook isn't called", async () => {
    const authenticate = vi.fn(() => Promise.reject(new Error("hook failed")));
    const app = await serve(await buildApiContainer({ authHook: { authenticate } }));

    const live = await injectJson(app, "GET", "/health/live");
    const ready = await injectJson(app, "GET", "/health/ready");

    expect([live.status, ready.status]).toEqual([200, 200]);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("TP-4.42x: the same hook still runs for /api/v1/* (A-154)", async () => {
    const authenticate = vi.fn(() => Promise.reject(new Error("hook failed")));
    const app = await serve(await buildApiContainer({ authHook: { authenticate } }));

    const res = await injectJson(app, "GET", "/api/v1/meta/client-config");

    expect(authenticate).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});

describe("TP-4.13: authentication and the version header key on the matched route (A-168)", () => {
  it("TP-4.13: GET /%61pi/v1/meta/client-config is authenticated and gets X-Budmon-API-Version", async () => {
    const authenticate = vi.fn(() => Promise.resolve(null));
    const app = await serve(await buildApiContainer({ authHook: { authenticate } }));

    const res = await injectJson(app, "GET", "/%61pi/v1/meta/client-config");

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(res.headers["x-budmon-api-version"]).toMatch(/^1\.\d+$/);
  });

  it("TP-4.13: GET /nope is neither authenticated nor versioned", async () => {
    const authenticate = vi.fn(() => Promise.resolve(null));
    const app = await serve(await buildApiContainer({ authHook: { authenticate } }));

    const res = await injectJson(app, "GET", "/nope");

    expect(res.status).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
    expect(res.headers["x-budmon-api-version"]).toBeUndefined();
  });
});

describe("TP-4.42x: checkReadiness, further cases (F-57)", () => {
  it("TP-4.42x: in development a journal ahead of the database is still ready", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());

    const result = await checkReadiness({
      db: built.container.database,
      appEnv: "development",
      journal: [{ hash: "h1", when: 1760000100000 }],
    });

    expect(result).toEqual({ ready: true });
  });

  it("TP-4.42x: in production with no migrations table and an empty journal, ready", async () => {
    const built = await buildApiContainer();
    cleanups.push(() => built.close());

    expect(
      await checkReadiness({ db: built.container.database, appEnv: "production", journal: [] }),
    ).toEqual({ ready: true });
  });
});
