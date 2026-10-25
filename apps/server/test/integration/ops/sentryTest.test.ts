// F-93 `diagnostics:sentry-test --yes` through runCli (A-288): it reports one test error through
// F-34 and flushes, printing {"sent":true}, or {"sent":false} with no SENTRY_DSN; without --yes it
// exits 2. The event is tagged error_key SENTRY_TEST (A-502 (9)). The Sentry endpoint is the local
// fake (test/support/fakeSentry.ts). TP-15.54: the automated half of TP-15.18 (AC-15.4), whose
// e-mail check stays manual.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Sentry from "@sentry/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";
import { sentryEvents, startFakeSentry, type FakeSentry } from "../../support/fakeSentry.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";
import { testWorkerEnv } from "../../support/worker.js";

let testDb: TestDatabase;
let dir: string;
let env: Record<string, string>;
let sentry: FakeSentry;

async function cli(argv: string[], withEnv: Readonly<Record<string, string | undefined>>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, withEnv, {
    stdout: (l) => stdout.push(l),
    stderr: (l) => stderr.push(l),
  });
  return { code, stdout, stderr };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  dir = mkdtempSync(path.join(tmpdir(), "budmon-sentry-test-"));
  env = testWorkerEnv(dir, testDb.endpoint, testDb.name, "general");
  sentry = await startFakeSentry();
}, 60_000);

afterAll(async () => {
  await Sentry.close(1_000);
  await sentry.close();
  rmSync(dir, { recursive: true, force: true });
  await testDb.drop();
});

describe("TP-15.54: diagnostics:sentry-test (F-93, AC-15.4)", () => {
  it("TP-15.54: without --yes it exits 2 and sends nothing", async () => {
    const r = await cli(["diagnostics:sentry-test"], { ...env, SENTRY_DSN: sentry.dsn });

    expect(r.code, [...r.stdout, ...r.stderr].join("\n")).toBe(2);
    expect(r.stdout.join("\n")).not.toContain('"sent"');
    expect(sentryEvents(sentry.bodies)).toEqual([]);
  }, 60_000);

  // A-506 (3): any other argument list is a usage error, before anything is sent.
  it.each([[["--force"]], [["--no"]], [["--yes", "--yes"]], [["--yes", "extra"]]])(
    "TP-15.54 (d): %j exits 64 with the usage text, nothing on stdout and no envelope",
    async (args) => {
      const r = await cli(["diagnostics:sentry-test", ...args], { ...env, SENTRY_DSN: sentry.dsn });

      expect(r.code, [...r.stdout, ...r.stderr].join("\n")).toBe(64);
      const stderr = r.stderr.join("\n");
      expect(stderr).toContain("Usage:");
      expect(stderr).toContain("diagnostics:sentry-test --yes");
      expect(stderr).not.toContain("run it with --yes");
      expect(r.stdout).toEqual([]);
      expect(sentryEvents(sentry.bodies)).toEqual([]);
    },
    60_000,
  );

  it("TP-15.54: --yes with no SENTRY_DSN prints {sent:false} and exits 0", async () => {
    const noDsn = { ...env };
    delete noDsn["SENTRY_DSN"];

    const r = await cli(["diagnostics:sentry-test", "--yes"], noDsn);

    expect(r.code, [...r.stdout, ...r.stderr].join("\n")).toBe(0);
    expect(r.stdout).toEqual(['{"sent":false}']);
    expect(sentryEvents(sentry.bodies)).toEqual([]);
  }, 60_000);

  // Last, because it initialises the process's Sentry client.
  it("TP-15.54: --yes with a DSN prints {sent:true}, exits 0, and sends one event: class Error, tags exactly { error_key: SENTRY_TEST }, no message, request or user", async () => {
    const r = await cli(["diagnostics:sentry-test", "--yes"], { ...env, SENTRY_DSN: sentry.dsn });

    expect(r.code, [...r.stdout, ...r.stderr].join("\n")).toBe(0);
    expect(r.stdout).toEqual(['{"sent":true}']);
    const events = sentryEvents(sentry.bodies);
    expect(events).toHaveLength(1);
    const event = events[0] ?? {};
    const values = (event["exception"] as { values?: { type?: unknown; value?: unknown }[] })
      .values;
    expect(values?.map((v) => [v.type, v.value])).toEqual([["Error", "Error"]]);
    expect(event["tags"]).toStrictEqual({ error_key: "SENTRY_TEST" });
    // TP-15.18: no request body, query string or user fields.
    expect(event["request"]).toBeUndefined();
    expect(event["user"]).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("budmon sentry test");
  }, 60_000);
});
