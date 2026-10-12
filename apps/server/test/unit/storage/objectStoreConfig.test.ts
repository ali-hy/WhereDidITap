// F-10's object-store settings: OBJECT_STORE_KIND required (A-307, TP-10.11) and the dev objects
// key never read outside development and test (A-303, review B-6, extra cases TP-10.13x). IDs
// ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/platform/config/loadConfig.js";
import { parseConfig, type ProcessKind } from "../../../src/platform/config/schema.js";
import {
  devApi,
  devWorker,
  prodApi,
  readFileFrom,
  withFile,
  type Fixture,
} from "../../support/configEnv.js";

function problemsOf(kind: ProcessKind, f: Fixture) {
  const files = Object.fromEntries(
    [...f.files].map(([p, content]) => [
      p,
      content.endsWith("\n") ? content.slice(0, -1) : content,
    ]),
  );
  const result = parseConfig(kind, { env: f.env, files });
  return result.ok ? [] : result.problems;
}

function withoutObjectStore(f: Fixture): Fixture {
  delete f.env["OBJECT_STORE_KIND"];
  delete f.env["OBJECT_STORE_FS_ROOT"];
  return f;
}

describe("TP-10.11: OBJECT_STORE_KIND is required for the api and a general worker (F-10, A-307)", () => {
  it("TP-10.11: an api without OBJECT_STORE_KIND has one problem, OBJECT_STORE_KIND required", () => {
    expect(problemsOf("api", withoutObjectStore(devApi()))).toEqual([
      { variable: "OBJECT_STORE_KIND", rule: "required" },
    ]);
  });

  it("TP-10.11: a worker with WORKER_ROLES=general without OBJECT_STORE_KIND has one problem, OBJECT_STORE_KIND required", () => {
    const f = withoutObjectStore(devWorker());
    f.env["WORKER_ROLES"] = "general";

    expect(problemsOf("worker", f)).toEqual([{ variable: "OBJECT_STORE_KIND", rule: "required" }]);
  });

  it("TP-10.11: a capture-only worker without OBJECT_STORE_KIND has no problem", () => {
    const f = withoutObjectStore(devWorker());
    f.env["WORKER_ROLES"] = "capture";
    // A-299: a capture-only worker connects as budmon_capture.
    f.env["DB_USER"] = "budmon_capture";

    expect(problemsOf("worker", f)).toEqual([]);
  });
});

describe("TP-10.13x (B-6): DEV_OBJECTS_SIGNING_KEY_FILE outside development and test (A-303)", () => {
  it.each([["rehearsal"], ["production"]] as const)(
    "TP-10.13x (B-6): an api in %s never reads DEV_OBJECTS_SIGNING_KEY_FILE and has no devObjectsKey",
    (appEnv) => {
      const f = prodApi(appEnv);
      withFile(f, "DEV_OBJECTS_SIGNING_KEY_FILE", Buffer.alloc(32, 7).toString("base64"));
      const read: string[] = [];
      const inner = readFileFrom(f.files);

      const config = loadConfig("api", f.env, (file: string) => {
        read.push(file);
        return inner(file);
      });

      expect(read).not.toContain(f.env["DEV_OBJECTS_SIGNING_KEY_FILE"]);
      expect(config.api?.devObjectsKey).toBeUndefined();
    },
  );
});

// A-356: a plain-http local S3 endpoint (versitygw) is allowed in development and test only.
describe("TP-10.11 (A-356): local http S3 endpoints", () => {
  function devS3(appEnv: "development" | "test", endpoint: string): Fixture {
    const f = devApi();
    Object.assign(f.env, {
      APP_ENV: appEnv,
      OBJECT_STORE_KIND: "s3",
      S3_ENDPOINT: endpoint,
      S3_REGION: "us-east-1",
      S3_BUCKET_EXPORTS: "budmon-exports",
      S3_BUCKET_ERASURE_LOG: "budmon-erasure-log",
    });
    delete f.env["OBJECT_STORE_FS_ROOT"];
    withFile(f, "S3_ACCESS_KEY_ID_FILE", "access-key-id");
    withFile(f, "S3_SECRET_ACCESS_KEY_FILE", "secret-access-key");
    return f;
  }

  it.each([
    ["development", "http://localhost:7070"],
    ["development", "http://127.0.0.1:7070"],
    ["test", "http://localhost:7070"],
    ["test", "http://127.0.0.1:7070"],
  ] as const)(
    "TP-10.11 (A-356): APP_ENV=%s with S3_ENDPOINT=%s has no problem",
    (appEnv, endpoint) => {
      expect(problemsOf("api", devS3(appEnv, endpoint))).toEqual([]);
    },
  );

  it.each([["http://localhost:7070"], ["http://127.0.0.1:7070"]])(
    "TP-10.11 (A-356): production with S3_ENDPOINT=%s has one problem, on S3_ENDPOINT",
    (endpoint) => {
      const f = prodApi();
      f.env["S3_ENDPOINT"] = endpoint;

      const problems = problemsOf("api", f);

      expect(problems).toHaveLength(1);
      expect(problems[0]?.variable).toBe("S3_ENDPOINT");
    },
  );

  it("TP-10.11 (A-356): a non-local http host in development has one problem, on S3_ENDPOINT", () => {
    const problems = problemsOf("api", devS3("development", "http://example.com:7070"));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.variable).toBe("S3_ENDPOINT");
  });
});
