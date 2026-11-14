// F-117 rewrapApiSecrets / rewrapApiSecretsCommand, F-118 platform.capture-rewrap, F-96's
// sealedColumns feeding secrets:rewrap-api (A-26). TP-8.7, TP-8.8 and TP-8.16.
//
// TP-8.7's "one row updated concurrently between select and update" has no hook in F-117; the
// test wraps the database so that, just before the rewrap's UPDATE of the chosen row runs, another
// connection changes that row (re-sealed under k2), so the rewrap's `AND <col> = $old` matches 0.
// A-245 accepts this proxy. A-253's cases re-seal the row under the old key instead, so the run
// must end (each id tried once per run) and the next run picks the row up. A-264: TP-8.8 (a)
// calls rewrapCaptureSecrets directly with a two-key unsealer; (b) runs the real job on the local
// provider, which doesn't support capture-key rotation.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { Temporal } from "@budmon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { createApiContainer, createWorkerContainer } from "../../../src/platform/container.js";
import { createSealedColumnRegistry } from "../../../src/platform/crypto/sealedColumns.js";
import type { Database } from "../../../src/platform/db/types.js";
import { buildHandlerMap } from "../../../src/platform/queue/handlers.js";
import { buildApiContainer, observed, testApiConfigFor } from "../../support/api.js";
import { devApi, withFile, type Fixture } from "../../support/configEnv.js";
import { query } from "../../support/postgres.js";
import { recordingLogger } from "../../support/platform.js";
import {
  type ApiSecretsCipher,
  createApiSecretsCipher,
} from "../../../src/platform/crypto/apiSecrets.js";
import { createCaptureSealer } from "../../../src/platform/crypto/captureSealer.js";
import {
  type CaptureUnsealer,
  createLocalCaptureUnsealer,
} from "../../../src/platform/crypto/captureUnsealer.js";
import { keyVersionOf } from "../../../src/platform/crypto/envelope.js";
import {
  rewrapApiSecrets,
  rewrapApiSecretsCommand,
  rewrapCaptureSecrets,
} from "../../../src/platform/crypto/rewrap.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerConfig } from "../../support/worker.js";

/** A new RSA-3072 pair (configEnv's rsaKeyPair is cached). */
function freshPair(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const COLUMN_API = {
  table: "sealed_test",
  idColumn: "id",
  column: "secret",
  purpose: "test.secret",
  provider: "api" as const,
};
const IDS = [1, 2, 3, 4].map((n) => `0190a0b0-1c2d-7e3f-8a4b-${String(n).padStart(12, "0")}`);

async function sealedTable(testDb: TestDatabase, grantTo: string): Promise<void> {
  const url = testDb.urlAs("budmon_migrator");
  await query(url, "CREATE TABLE sealed_test (id uuid PRIMARY KEY, secret bytea)");
  await query(url, `GRANT SELECT, UPDATE ON sealed_test TO ${grantTo}`);
}

async function rows(testDb: TestDatabase): Promise<{ id: string; secret: Buffer }[]> {
  return (
    await query<{ id: string; secret: Buffer }>(
      testDb.urlAs("budmon_migrator"),
      "SELECT id::text AS id, secret FROM sealed_test ORDER BY id",
    )
  ).map((r) => ({ id: r.id, secret: Buffer.from(r.secret) }));
}

async function insert(testDb: TestDatabase, id: string, secret: Buffer): Promise<void> {
  await query(
    testDb.urlAs("budmon_migrator"),
    "INSERT INTO sealed_test (id, secret) VALUES ($1, $2)",
    [id, secret],
  );
}

function ciphers() {
  return {
    k1Only: createApiSecretsCipher({ current: "k1", keys: new Map([["k1", K1]]) }),
    current: createApiSecretsCipher({
      current: "k2",
      keys: new Map([
        ["k1", K1],
        ["k2", K2],
      ]),
    }),
  };
}

const ctx = (id: string) => ({ table: "sealed_test", rowId: id, purpose: "test.secret" });

/**
 * `db` with a hook: before any statement whose text starts with UPDATE and whose values include
 * `rowId`, `before()` runs once (another connection's change).
 */
function interceptUpdate(db: Database, rowId: string, before: () => Promise<void>): Database {
  let fired = false;
  const hook = async (text: unknown, values: unknown): Promise<void> => {
    const inner = typeof text === "string" ? undefined : (text as { text?: unknown }).text;
    const sql = typeof text === "string" ? text : typeof inner === "string" ? inner : "";
    const params = Array.isArray(values) ? values : ((text as { values?: unknown[] }).values ?? []);
    if (!fired && /^\s*update/i.test(sql) && params.some((v) => v === rowId)) {
      fired = true;
      await before();
    }
  };
  const wrapClient = <C extends { query: (...args: never[]) => unknown }>(client: C): C =>
    new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async (text: unknown, values?: unknown) => {
            await hook(text, values);
            return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  const pool = new Proxy(db.pool, {
    get(target, prop, receiver) {
      if (prop === "connect") {
        return async () => wrapClient(await target.connect());
      }
      if (prop === "query") {
        return async (text: unknown, values?: unknown) => {
          await hook(text, values);
          return (target.query as (...a: unknown[]) => unknown).call(target, text, values);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const handle = new Proxy(db.handle, {
    get(target, prop, receiver) {
      if (prop === "executeSql") {
        return async (text: string, values?: readonly unknown[]) => {
          await hook(text, values);
          return target.executeSql(text, values);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { ...db, pool, handle, close: () => db.close() };
}

describe("TP-8.7: rewrapApiSecrets (F-117)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await sealedTable(testDb, "budmon_app");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.7: 3 rows under k1 and 1 under k2, one k1 row changed concurrently: {rewrapped 2, skipped 1}; every row ends under k2 and the rewrapped ones unseal to their plaintext", async () => {
    const { k1Only, current } = ciphers();
    const plaintexts = new Map(IDS.map((id, i) => [id, Buffer.from(`secret-${String(i)}`)]));
    for (const [i, id] of IDS.entries()) {
      const cipher: ApiSecretsCipher = i < 3 ? k1Only : current;
      await insert(testDb, id, cipher.seal(plaintexts.get(id) ?? Buffer.alloc(0), ctx(id)));
    }
    const raced = IDS[1] ?? "";
    const changedTo = Buffer.from("changed concurrently");
    const database = interceptUpdate(testDb.database, raced, async () => {
      await query(
        testDb.urlAs("budmon_migrator"),
        "UPDATE sealed_test SET secret = $2 WHERE id = $1",
        [raced, current.seal(changedTo, ctx(raced))],
      );
    });

    const result = await rewrapApiSecrets({
      database,
      cipher: current,
      columns: [COLUMN_API],
      logger: recordingLogger(),
    });

    expect(result).toEqual({ rewrapped: 2, skipped: 1 });
    for (const row of await rows(testDb)) {
      expect(keyVersionOf(row.secret), row.id).toBe("k2");
      const expected = row.id === raced ? changedTo : plaintexts.get(row.id);
      expect(current.unseal(row.secret, ctx(row.id)), row.id).toEqual(expected);
    }
  });
});

describe("TP-8.7 (A-253, A-254): a concurrently changed row still on the old key", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await sealedTable(testDb, "budmon_app");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.7 (A-253, A-254): re-sealed under k1 by the proxy, the run ends with skipped 1 and one api_secrets_rewrap line; a second run re-wraps it", async () => {
    const { k1Only, current } = ciphers();
    for (const id of IDS.slice(0, 3)) {
      await insert(testDb, id, k1Only.seal(Buffer.from(id), ctx(id)));
    }
    const raced = IDS[1] ?? "";
    const changedTo = Buffer.from("changed concurrently, still k1");
    const database = interceptUpdate(testDb.database, raced, async () => {
      await query(
        testDb.urlAs("budmon_migrator"),
        "UPDATE sealed_test SET secret = $2 WHERE id = $1",
        [raced, k1Only.seal(changedTo, ctx(raced))],
      );
    });
    const logger = recordingLogger();

    const first = await rewrapApiSecrets({
      database,
      cipher: current,
      columns: [COLUMN_API],
      logger,
    });

    expect(first).toEqual({ rewrapped: 2, skipped: 1 });
    const lines = logger.lines.filter((l) => l.event === "api_secrets_rewrap");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.fields).toMatchObject({ fields: { count: 2 } });
    const versions = new Map((await rows(testDb)).map((r) => [r.id, keyVersionOf(r.secret)]));
    expect(versions.get(raced)).toBe("k1");

    const second = await rewrapApiSecrets({
      database: testDb.database,
      cipher: current,
      columns: [COLUMN_API],
      logger: recordingLogger(),
    });

    expect(second).toEqual({ rewrapped: 1, skipped: 0 });
    for (const row of await rows(testDb)) {
      expect(keyVersionOf(row.secret), row.id).toBe("k2");
      const expected = row.id === raced ? changedTo : Buffer.from(row.id);
      expect(current.unseal(row.secret, ctx(row.id)), row.id).toEqual(expected);
    }
  });
});

/** Rows sealed under local:1 with key pair `one`, and the local:1/local:2 unsealer (TP-8.8 (a)). */
function captureKeys() {
  const one = freshPair();
  const two = freshPair();
  const old = createCaptureSealer({ publicKeyPem: one.publicPem, keyVersion: "local:1" });
  const sealer = createCaptureSealer({ publicKeyPem: two.publicPem, keyVersion: "local:2" });
  const unsealOne = createLocalCaptureUnsealer({
    privateKeyPem: one.privatePem,
    keyVersion: "local:1",
  });
  const unsealTwo = createLocalCaptureUnsealer({
    privateKeyPem: two.privatePem,
    keyVersion: "local:2",
  });
  // The injected unsealer holding both keys (A-264: the function-level path KMS uses).
  const both: CaptureUnsealer = {
    unseal: (envelope, c) =>
      keyVersionOf(envelope) === "local:1"
        ? unsealOne.unseal(envelope, c)
        : unsealTwo.unseal(envelope, c),
  };
  return { one, two, old, sealer, unsealTwo, both };
}

const CAPTURE_COLUMN = { ...COLUMN_API, provider: "capture" as const };

describe("TP-8.8 (a): rewrapCaptureSecrets (F-118, A-264)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    await sealedTable(testDb, "budmon_capture");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.8 (a): rows sealed under local:1 are re-sealed under local:2 and unseal to their plaintext", async () => {
    const k = captureKeys();
    const plain = new Map(IDS.slice(0, 2).map((id) => [id, Buffer.from(`capture-${id}`)]));
    for (const [id, p] of plain) await insert(testDb, id, k.old.seal(p, ctx(id)));
    const logger = recordingLogger();

    await rewrapCaptureSecrets({
      database: testDb.database,
      unsealer: k.both,
      sealer: k.sealer,
      columns: [CAPTURE_COLUMN, COLUMN_API],
      keyVersion: "local:2",
      logger,
    });

    for (const row of await rows(testDb)) {
      expect(keyVersionOf(row.secret), row.id).toBe("local:2");
      expect(await k.unsealTwo.unseal(row.secret, ctx(row.id)), row.id).toEqual(plain.get(row.id));
    }
    expect(logger.lines.filter((l) => l.event === "capture_rewrap")).toHaveLength(1);
  });
});

describe("TP-8.8 (a) (A-253): a capture row whose re-seal is skipped", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    await sealedTable(testDb, "budmon_capture");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.8 (a) (A-253): a row changed under local:1 during the run is skipped and the run ends; the next run re-seals it under local:2", async () => {
    const k = captureKeys();
    const plain = new Map(IDS.slice(0, 2).map((id) => [id, Buffer.from(`capture-${id}`)]));
    for (const [id, p] of plain) await insert(testDb, id, k.old.seal(p, ctx(id)));
    const raced = IDS[0] ?? "";
    const changedTo = Buffer.from("changed concurrently, still local:1");
    const raceDb = interceptUpdate(testDb.database, raced, async () => {
      await query(
        testDb.urlAs("budmon_migrator"),
        "UPDATE sealed_test SET secret = $2 WHERE id = $1",
        [raced, k.old.seal(changedTo, ctx(raced))],
      );
    });
    const deps = {
      unsealer: k.both,
      sealer: k.sealer,
      columns: [CAPTURE_COLUMN],
      keyVersion: "local:2",
      logger: recordingLogger(),
    };

    await rewrapCaptureSecrets({ ...deps, database: raceDb });

    const afterFirst = new Map((await rows(testDb)).map((r) => [r.id, keyVersionOf(r.secret)]));
    expect(afterFirst.get(raced)).toBe("local:1");
    expect(afterFirst.get(IDS[1] ?? "")).toBe("local:2");

    await rewrapCaptureSecrets({ ...deps, database: testDb.database });

    for (const row of await rows(testDb)) {
      expect(keyVersionOf(row.secret), row.id).toBe("local:2");
      const expected = row.id === raced ? changedTo : plain.get(row.id);
      expect(await k.unsealTwo.unseal(row.secret, ctx(row.id)), row.id).toEqual(expected);
    }
  });
});

describe("TP-8.8 (b): the job on the local provider (F-118, A-264)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase("budmon_capture");
    await sealedTable(testDb, "budmon_capture");
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("TP-8.8 (b): KMS_PROVIDER=local, CAPTURE_KEY_VERSION=local:2: the handler completes, rows stay unchanged, and one capture_rewrap_unsupported warn line is logged", async () => {
    const k = captureKeys();
    for (const id of IDS.slice(0, 2))
      await insert(testDb, id, k.old.seal(Buffer.from(id), ctx(id)));
    const before = await rows(testDb);
    const sealedColumns = createSealedColumnRegistry();
    sealedColumns.register(CAPTURE_COLUMN);
    const obs = observed();
    const config = testWorkerConfig(
      testDb.endpoint,
      testDb.name,
      "capture",
      { KMS_PROVIDER: "local", CAPTURE_KEY_VERSION: "local:2" },
      { CAPTURE_PUBLIC_KEY_FILE: k.two.publicPem, CAPTURE_PRIVATE_KEY_FILE: k.two.privatePem },
    );
    const c = createWorkerContainer(config, { ...obs.overrides, sealedColumns });
    try {
      const handler = buildHandlerMap(c).get("platform.capture-rewrap");
      expect(handler).toBeDefined();

      await handler?.(
        {},
        {
          jobId: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
          attempt: 1,
          createdOn: Temporal.Now.instant(),
          logger: c.logger,
          signal: new AbortController().signal,
        },
      );

      expect(await rows(testDb)).toEqual(before);
      const warned = obs.capture
        .records()
        .filter((l) => l["event"] === "capture_rewrap_unsupported");
      expect(warned).toHaveLength(1);
      expect(warned[0]?.["level"]).toBe("warn");
    } finally {
      await c.close();
    }
  });
});

describe("TP-8.16: the container's sealed-column registry feeds secrets:rewrap-api (F-96, F-117, A-26)", () => {
  const ring = JSON.stringify({
    current: "k2",
    keys: { k1: K1.toString("base64"), k2: K2.toString("base64") },
  });
  const fixture = (): Fixture => {
    const f = devApi();
    withFile(f, "API_SECRETS_KEYS_FILE", ring);
    return f;
  };

  it("TP-8.16: with sealed_test registered through the override, rewrapApiSecretsCommand re-wraps both k1 rows to k2", async () => {
    const { k1Only } = ciphers();
    const sealedColumns = createSealedColumnRegistry();
    sealedColumns.register(COLUMN_API);
    const built = await buildApiContainer({ sealedColumns }, {}, fixture);
    try {
      await sealedTable(built.testDb, "budmon_app");
      for (const id of IDS.slice(0, 2))
        await insert(built.testDb, id, k1Only.seal(Buffer.from(id), ctx(id)));

      const container: unknown = built.container;
      const result = await rewrapApiSecretsCommand(
        container as Parameters<typeof rewrapApiSecretsCommand>[0],
      );

      expect(result).toEqual({ rewrapped: 2, skipped: 0 });
      for (const row of await rows(built.testDb)) expect(keyVersionOf(row.secret)).toBe("k2");
    } finally {
      await built.close();
    }
  });

  it("TP-8.16: createApiContainer(config) with no override has sealedColumns.all() = []", async () => {
    const testDb = await createTestDatabase();
    const c = createApiContainer(
      testApiConfigFor(testDb, "budmon_app", {}, fixture),
      observed().overrides,
    );
    try {
      expect(c.sealedColumns.all()).toEqual([]);
    } finally {
      await c.close();
      await testDb.drop();
    }
  });

  it("TP-8.16 (A-250): CLI secrets:rewrap-api (kind api) on that database (nothing registered) prints {rewrapped:0, skipped:0} and exits 0", async () => {
    const testDb = await createTestDatabase();
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-rewrap-cli-"));
    try {
      await sealedTable(testDb, "budmon_app");
      // A-250: kind api; the helpers' minimal api environment (devApi) with its files written
      // into dir, DB_* for this file's database as budmon_app, and the {current k2, keys k1, k2}
      // API_SECRETS_KEYS_FILE.
      const f = fixture();
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(f.env)) {
        if (value === undefined) continue;
        const content = f.files.get(value);
        if (content === undefined) env[key] = value;
        else {
          const file = path.join(dir, key.toLowerCase());
          writeFileSync(file, content);
          env[key] = file;
        }
      }
      const passwordFile = path.join(dir, "db_password");
      writeFileSync(
        passwordFile,
        `${(await import("../../support/postgres.js")).TEST_ROLE_PASSWORDS.budmon_app}\n`,
      );
      Object.assign(env, {
        DB_HOST: testDb.endpoint.host,
        DB_PORT: String(testDb.endpoint.port),
        DB_NAME: testDb.name,
        DB_USER: "budmon_app",
        DB_PASSWORD_FILE: passwordFile,
        OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
      });
      const stdout: string[] = [];
      const stderr: string[] = [];

      const code = await runCli(["secrets:rewrap-api"], env, {
        stdout: (l) => stdout.push(l),
        stderr: (l) => stderr.push(l),
      });

      expect(code, stderr.join("\n")).toBe(0);
      expect(stdout.map((l) => JSON.parse(l) as unknown)).toEqual([{ rewrapped: 0, skipped: 0 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await testDb.drop();
    }
  });
});
