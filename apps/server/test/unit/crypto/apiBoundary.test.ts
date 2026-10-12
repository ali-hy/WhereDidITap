// The API can't unseal capture secrets (F-96, F-10, A-248), and configKeysFor doesn't drift from
// what the schema reads (A-251). TP-8.15, plus extra cases TP-8.17x.
//
// The A-251 drift guard records reads on the env given to parseConfig (F-10), the function
// loadConfig calls: loadConfig itself enumerates its env (Object.entries) to scope it, so a
// recording Proxy there would record every key it was given.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import { createApiContainer } from "../../../src/platform/container.js";
import { observed } from "../../support/api.js";
import {
  base64Bytes,
  devApi,
  devMigrate,
  devWorker,
  type Fixture,
  prodApi,
  prodMigrate,
  prodWorkerCapture,
  prodWorkerGeneral,
  readFileFrom,
  rsaKeyPair,
  withFile,
} from "../../support/configEnv.js";
import {
  allConfigKeys,
  configKeysFor,
  parseConfig,
  type ProcessKind,
  type WorkerRole,
} from "../../../src/platform/config/schema.js";

const CAPTURE_ONLY = [
  "CAPTURE_PRIVATE_KEY_FILE",
  "GCP_CREDENTIALS_FILE",
  "KMS_PROVIDER",
  "MAILBOX_HMAC_KEY_FILE",
];

describe("TP-8.15: no capture unsealer on the API side (F-96, F-10)", () => {
  function apiFixtureWithCaptureSecrets() {
    const f = devApi();
    f.env["KMS_PROVIDER"] = "gcp";
    withFile(f, "CAPTURE_PRIVATE_KEY_FILE", rsaKeyPair().privatePem);
    withFile(
      f,
      "GCP_CREDENTIALS_FILE",
      JSON.stringify({ type: "service_account", project_id: "p" }),
    );
    withFile(f, "MAILBOX_HMAC_KEY_FILE", base64Bytes(32));
    return f;
  }

  it("TP-8.15 (A-248): configKeysFor('api') has none of the capture-only variables", () => {
    const keys = configKeysFor("api");

    for (const key of CAPTURE_ONLY) expect(keys).not.toContain(key);
  });

  it("TP-8.17x (A-248): configKeysFor is sorted, and a capture worker's list has the capture-only variables", () => {
    const api = configKeysFor("api");
    const capture = configKeysFor("worker", ["capture"]);

    expect([...api]).toEqual([...api].sort());
    expect([...capture]).toEqual([...capture].sort());
    for (const key of ["CAPTURE_PRIVATE_KEY_FILE", "MAILBOX_HMAC_KEY_FILE"]) {
      expect(capture).toContain(key);
    }
  });

  it("TP-8.15 (A-248): with every capture variable set, loadConfig('api') never reads their files and holds no private key or KMS settings", () => {
    const f = apiFixtureWithCaptureSecrets();
    const read: string[] = [];
    const inner = readFileFrom(f.files);

    const config = loadConfig("api", f.env, (path: string) => {
      read.push(path);
      return inner(path);
    });

    for (const variable of [
      "CAPTURE_PRIVATE_KEY_FILE",
      "GCP_CREDENTIALS_FILE",
      "MAILBOX_HMAC_KEY_FILE",
    ]) {
      expect(read).not.toContain(f.env[variable]);
    }
    const text = JSON.stringify(config);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("service_account");
    expect(config.capture?.kms).toBeUndefined();
  });

  it("TP-8.15: an ApiContainer has no captureUnsealer member", async () => {
    const f = devApi();
    const config = loadConfig("api", f.env, readFileFrom(f.files));
    const c = createApiContainer(config, observed().overrides);
    try {
      expect("captureUnsealer" in c).toBe(false);
    } finally {
      await c.close();
    }
  });
});

describe("TP-8.15 (A-251): configKeysFor covers every variable the schema reads", () => {
  function trimOneNewline(text: string): string {
    if (text.endsWith("\r\n")) return text.slice(0, -2);
    return text.endsWith("\n") ? text.slice(0, -1) : text;
  }

  it.each<[string, () => Fixture]>([
    ["api (development)", devApi],
    ["api (production)", () => prodApi()],
    ["migrate (development)", devMigrate],
    ["migrate (production)", prodMigrate],
    ["worker capture,general (development)", devWorker],
    ["worker capture (production)", () => prodWorkerCapture()],
    ["worker general (production)", () => prodWorkerGeneral()],
  ])("TP-8.15 (A-251): %s reads only variables in configKeysFor(kind, roles)", (_label, make) => {
    const f = make();
    const kind: ProcessKind = f.kind;
    const roles =
      kind === "worker"
        ? (f.env["WORKER_ROLES"] ?? "")
            .split(",")
            .map((r) => r.trim())
            .filter((r): r is WorkerRole => r === "capture" || r === "general")
        : undefined;
    const allowed = new Set(configKeysFor(kind, roles));
    // Every known variable outside the list is present too, so a schema read of one is recorded.
    const env: Record<string, string | undefined> = { ...f.env };
    for (const key of allConfigKeys()) if (!allowed.has(key) && !(key in env)) env[key] = "x";
    const read = new Set<string>();
    const recording = new Proxy(env, {
      get(target, key, receiver) {
        if (typeof key === "string") read.add(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const files = Object.fromEntries(
      [...f.files].map(([path, content]) => [path, trimOneNewline(content)]),
    );

    const result = parseConfig(kind, { env: recording, files });

    expect(result.ok, JSON.stringify(result.ok ? null : result.problems)).toBe(true);
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((key) => !allowed.has(key))).toEqual([]);
  });
});
