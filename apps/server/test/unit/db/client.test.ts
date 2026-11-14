// F-12 createDatabase. TP-2.19: the pg.Pool options, through a spy on the Pool constructor.
import { afterEach, describe, expect, it, vi } from "vitest";

const poolConfigs: unknown[] = [];

vi.mock("pg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pg")>();
  class SpyPool extends actual.default.Pool {
    constructor(config?: import("pg").PoolConfig) {
      poolConfigs.push(config);
      super(config);
    }
  }
  return { ...actual, Pool: SpyPool, default: { ...actual.default, Pool: SpyPool } };
});

const { createDatabase } = await import("../../../src/platform/db/client.js");
const { Secret } = await import("../../../src/platform/observability/redaction.js");

function dbConfig(overrides: Record<string, unknown>) {
  return {
    host: "db.budmon.internal",
    port: 5432,
    name: "budmon",
    user: "budmon_app",
    password: Secret.of("pw"),
    sslmode: "disable" as const,
    poolMax: 7,
    ...overrides,
  };
}

afterEach(() => {
  poolConfigs.length = 0;
});

describe("TP-2.19: createDatabase pool options", () => {
  it("TP-2.19: sslmode disable: max, application_name, timeouts, ssl false", async () => {
    const database = createDatabase(dbConfig({}), { applicationName: "budmon-api" });

    expect(poolConfigs).toHaveLength(1);
    expect(poolConfigs[0]).toMatchObject({
      max: 7,
      application_name: "budmon-api",
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 60000,
      ssl: false,
    });
    await database.close();
  });

  it("TP-2.19: verify-full with a CA: ssl { ca, rejectUnauthorized: true, servername: host }", async () => {
    const ca = Buffer.from("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");

    const database = createDatabase(dbConfig({ sslmode: "verify-full", sslRootCert: ca }), {
      applicationName: "budmon-worker-capture",
    });

    expect(poolConfigs[0]).toMatchObject({
      max: 7,
      ssl: { ca, rejectUnauthorized: true, servername: "db.budmon.internal" },
    });
    await database.close();
  });

  it("TP-2.44x: construction opens no connection and the handle isn't in a transaction", async () => {
    const database = createDatabase(dbConfig({ host: "203.0.113.1" }), {
      applicationName: "budmon-api",
    });

    expect(database.handle.inTransaction).toBe(false);
    expect(database.pool.totalCount).toBe(0);
    await database.close();
  });
});
