// F-39 with F-34 in real processes (A-118, A-120). TP-3.17 (b): child processes run
// test/fixtures/fatalChild.ts, which sets up the api entry's fatal handlers and then hits an
// unhandled rejection or an uncaught exception carrying a canary; (b1) with Sentry pointing at an
// in-test envelope server, (b2) with no DSN. (a) is a unit test (unit/observability/fatal.test.ts).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { sentryEvents, startFakeSentry, type FakeSentry } from "../../support/fakeSentry.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");
const CHILD = path.join(SERVER_DIR, "test/fixtures/fatalChild.ts");
const F31_KEYS = ["level", "time", "service", "release", "event"];

interface ChildRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChild(mode: "unhandled" | "uncaught", dsn?: string): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CHILD, mode], {
      cwd: SERVER_DIR,
      env: { PATH: process.env["PATH"] ?? "", ...(dsn === undefined ? {} : { SENTRY_DSN: dsn }) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child ${mode} timed out`));
    }, 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Every non-empty line is an F-31 JSON line. */
function expectOnlyF31Lines(text: string, stream: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of text.split("\n").filter((l) => l !== "")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${stream} holds a non-JSON line: ${line.slice(0, 200)}`);
    }
    expect(typeof parsed === "object" && parsed !== null, `${stream}: ${line}`).toBe(true);
    const record = parsed as Record<string, unknown>;
    for (const key of F31_KEYS) expect(record, `${stream}: ${line}`).toHaveProperty(key);
    records.push(record);
  }
  return records;
}

const CASES = [
  ["unhandled", "unhandled_rejection"],
  ["uncaught", "uncaught_exception"],
] as const;

let servers: FakeSentry[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

describe("TP-3.17 (b1): with Sentry pointing at the test's envelope server", () => {
  it.each(CASES)(
    "TP-3.17 (b1): %s: exit 1, only F-31 lines, one envelope, no canary anywhere",
    async (mode, event) => {
      const sentry = await startFakeSentry();
      servers.push(sentry);

      const run = await runChild(mode, sentry.dsn);

      expect(run.code, run.stderr).toBe(1);
      const records = [
        ...expectOnlyF31Lines(run.stdout, "stdout"),
        ...expectOnlyF31Lines(run.stderr, "stderr"),
      ];
      expect(records.filter((r) => r["event"] === event)).toHaveLength(1);
      expect(records.find((r) => r["event"] === event)).toMatchObject({ errorClass: "Error" });
      expect(sentryEvents(sentry.bodies)).toHaveLength(1);
      expect(
        scanForCanaries(
          [
            { name: "stdout", text: run.stdout },
            { name: "stderr", text: run.stderr },
            ...sentry.bodies.map((text, i) => ({ name: `envelope ${String(i)}`, text })),
          ],
          CANARIES,
        ),
      ).toEqual([]);
    },
    90_000,
  );
});

describe("TP-3.17 (b2): with no DSN", () => {
  it.each(CASES)(
    "TP-3.17 (b2): %s: exit 1, only F-31 lines, no canary anywhere",
    async (mode, event) => {
      const run = await runChild(mode);

      expect(run.code, run.stderr).toBe(1);
      const records = [
        ...expectOnlyF31Lines(run.stdout, "stdout"),
        ...expectOnlyF31Lines(run.stderr, "stderr"),
      ];
      expect(records.filter((r) => r["event"] === event)).toHaveLength(1);
      expect(
        scanForCanaries(
          [
            { name: "stdout", text: run.stdout },
            { name: "stderr", text: run.stderr },
          ],
          CANARIES,
        ),
      ).toEqual([]);
    },
    90_000,
  );
});
