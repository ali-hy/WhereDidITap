// F-22 step 1, waitForPostgres (A-86, A-97). TP-2.39 (a), (b) and (b2), plus extra cases TP-2.80x
// (authorisation errors) and TP-2.74x for S-2 QA's race: the image's init server answers on the socket (so `pg_isready` through
// `docker compose exec` succeeds) while TCP still refuses or resets connections. The wait must
// end only on a successful TCP query through `connect`.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// TP-2.39 (c) tests F-26's runCommand (A-89), in unit/observability/runCommand.test.ts.
import { describe, expect, it } from "vitest";
import { PostgresNotReadyError, waitForPostgres } from "../../../src/main/dev.js";
import { runCommand } from "../../../src/platform/observability/describeFailure.js";

const URL = "postgres://postgres:postgres@localhost:5432/postgres";
const START = 1_700_000_000_000;
const TIMEOUT_MESSAGE = "Postgres didn't become ready within 60 s";

function systemError(code: string): Error {
  return Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code });
}

interface Fakes {
  deps: Parameters<typeof waitForPostgres>[1];
  connects: { url: string; timeoutMs: number; at: number }[];
  sleeps: number[];
  /** Every call in order: `connect` or `sleep:<ms>`. */
  calls: string[];
  clock: { now: number };
}

/** A fake clock that only `sleep` advances, and a `connect` driven by `outcomes`. */
function fakes(outcomes: (attempt: number) => Error | undefined): Fakes {
  const clock = { now: START };
  const connects: Fakes["connects"] = [];
  const sleeps: number[] = [];
  const calls: string[] = [];
  return {
    connects,
    sleeps,
    calls,
    clock,
    deps: {
      connect: (url, timeoutMs) => {
        connects.push({ url, timeoutMs, at: clock.now });
        calls.push("connect");
        const failure = outcomes(connects.length);
        return failure === undefined ? Promise.resolve() : Promise.reject(failure);
      },
      sleep: (ms) => {
        sleeps.push(ms);
        calls.push(`sleep:${String(ms)}`);
        clock.now += ms;
        return Promise.resolve();
      },
      now: () => clock.now,
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("TP-2.39: waitForPostgres", () => {
  it("TP-2.39 (a): three ECONNREFUSED then success resolves after 4 connects of 2000 ms, sleeping 500 ms between", async () => {
    const f = fakes((n) => (n <= 3 ? systemError("ECONNREFUSED") : undefined));

    await waitForPostgres(URL, f.deps);

    expect(f.connects).toHaveLength(4);
    expect(f.connects.map((c) => c.timeoutMs)).toEqual([2000, 2000, 2000, 2000]);
    expect(f.calls).toEqual([
      "connect",
      "sleep:500",
      "connect",
      "sleep:500",
      "connect",
      "sleep:500",
      "connect",
    ]);
  });

  it("TP-2.39 (b): a connect that always fails rejects with PostgresNotReadyError once now passes 60 s (A-97)", async () => {
    const f = fakes(() => systemError("ECONNREFUSED"));

    const error = await rejection(waitForPostgres(URL, f.deps));

    expect(error).toBeInstanceOf(PostgresNotReadyError);
    expect((error as PostgresNotReadyError).reason).toBe("postgres_not_ready");
    expect((error as Error).message).toBe(TIMEOUT_MESSAGE);
    // It kept trying until 60 s had gone by, and gave up within one interval after that.
    const lastAttempt = f.connects.at(-1)?.at ?? START;
    expect(lastAttempt).toBeGreaterThanOrEqual(START + 60_000 - 500);
    expect(f.clock.now).toBeGreaterThanOrEqual(START + 60_000);
    expect(f.clock.now).toBeLessThanOrEqual(START + 60_000 + 500);
    expect(new Set(f.sleeps)).toEqual(new Set([500]));
  });

  it("TP-2.39 (b): through runCommand the line is exactly pnpm dev failed: PostgresNotReadyError (postgres_not_ready)", async () => {
    const f = fakes(() => systemError("ECONNREFUSED"));
    const lines: string[] = [];

    const code = await runCommand(
      "pnpm dev",
      () => waitForPostgres(URL, f.deps),
      (line) => {
        lines.push(line);
      },
    );

    expect(code).toBe(1);
    expect(lines).toEqual(["pnpm dev failed: PostgresNotReadyError (postgres_not_ready)"]);
  });

  it("TP-2.39 (b2): a pg error 28P01 rejects with that error after one call, with no sleep (A-97)", async () => {
    const authError = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const f = fakes(() => authError);

    const error = await rejection(waitForPostgres(URL, f.deps));

    expect(error).toBe(authError);
    expect(f.connects).toHaveLength(1);
    expect(f.sleeps).toEqual([]);
  });
});

describe("TP-2.80x: waitForPostgres, authorisation errors (A-97)", () => {
  it("TP-2.80x: 28000 (invalid authorisation) also stops at once", async () => {
    const authError = Object.assign(new Error("role is not permitted to log in"), {
      code: "28000",
    });
    const f = fakes(() => authError);

    const error = await rejection(waitForPostgres(URL, f.deps));

    expect(error).toBe(authError);
    expect(f.calls).toEqual(["connect"]);
  });

  it("TP-2.80x: 28P01 after a refused connection stops at that call", async () => {
    const authError = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const f = fakes((n) => (n === 1 ? systemError("ECONNREFUSED") : authError));

    const error = await rejection(waitForPostgres(URL, f.deps));

    expect(error).toBe(authError);
    expect(f.calls).toEqual(["connect", "sleep:500", "connect"]);
  });

  it("TP-2.80x: through runCommand a 28P01 prints pnpm dev failed: Error 28P01", async () => {
    const f = fakes(() =>
      Object.assign(new Error("password authentication failed"), { code: "28P01" }),
    );
    const lines: string[] = [];

    await runCommand(
      "pnpm dev",
      () => waitForPostgres(URL, f.deps),
      (line) => {
        lines.push(line);
      },
    );

    expect(lines).toEqual(["pnpm dev failed: Error 28P01"]);
  });
});

describe("TP-2.74x: waitForPostgres and the init-server race (A-86)", () => {
  it("TP-2.74x: connect gets the URL it was given, the one the tools use", async () => {
    const f = fakes(() => undefined);

    await waitForPostgres(URL, f.deps);

    expect(f.connects.map((c) => c.url)).toEqual([URL]);
  });

  it("TP-2.74x: ECONNRESET and ECONNREFUSED while the init server runs are retried until a TCP query succeeds", async () => {
    const failures = ["ECONNREFUSED", "ECONNRESET", "ECONNRESET", "ECONNREFUSED"];
    const f = fakes((n) => {
      const code = failures[n - 1];
      return code === undefined ? undefined : systemError(code);
    });

    await waitForPostgres(URL, f.deps);

    expect(f.connects).toHaveLength(5);
    expect(f.sleeps).toEqual([500, 500, 500, 500]);
  });

  it("TP-2.74x: it doesn't resolve before connect has succeeded", async () => {
    let succeeded = false;
    const f = fakes((n) => (n < 3 ? systemError("ECONNRESET") : undefined));
    const connect = f.deps.connect.bind(f.deps);
    f.deps.connect = async (url, timeoutMs) => {
      await connect(url, timeoutMs);
      succeeded = true;
    };

    await waitForPostgres(URL, f.deps);

    expect(succeeded).toBe(true);
  });

  it("TP-2.74x: a first-try success neither sleeps nor connects again", async () => {
    const f = fakes(() => undefined);

    await waitForPostgres(URL, f.deps);

    expect(f.calls).toEqual(["connect"]);
  });

  it("TP-2.74x: opts.intervalMs and opts.timeoutMs replace 500 ms and 60 s", async () => {
    const f = fakes(() => systemError("ECONNREFUSED"));

    const error = await rejection(
      waitForPostgres(URL, f.deps, { intervalMs: 100, timeoutMs: 1_000 }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(new Set(f.sleeps)).toEqual(new Set([100]));
    expect(f.clock.now).toBeGreaterThanOrEqual(START + 1_000);
    expect(f.clock.now).toBeLessThanOrEqual(START + 1_100);
  });
});
