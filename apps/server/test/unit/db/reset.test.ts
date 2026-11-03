// F-20 guards. TP-2.16 (a) (the refusals; (b) is integration/db/reset.test.ts) and TP-2.24 (a)
// to (d) for seedDevelopmentDatabase, plus extra cases TP-2.45x, TP-2.67x, TP-2.69x, TP-2.78x and TP-2.82x
// for the rest of step 1's guard. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// A-79: F-20 never reads process.env; only the explicit `allowNonLocalHost` input relaxes the host
// allowlist, and nothing else. A-84: each refusal carries a `reason`, and its message is
// `<base>: <phrase>`, the phrase fixed per reason, never any part of the URL.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ResetRefusedError,
  resetDevelopmentDatabase,
  seedDevelopmentDatabase,
} from "../../../src/platform/db/reset.js";
import { testRoleSecrets } from "../../support/postgres.js";

const RESET_BASE = "db:reset only runs against a local development or test database";
const SEED_BASE = "db:seed only runs against a local development or test database";

type Reason =
  "app_env" | "non_local_host" | "host_parameter" | "host_list" | "socket_path" | "unparseable_url";

const PHRASES: Record<Exclude<Reason, "app_env">, string> = {
  non_local_host: "the host isn't local",
  host_parameter: "the URL sets a host parameter",
  host_list: "the URL lists several hosts",
  socket_path: "the URL is a socket path",
  unparseable_url: "the URL can't be parsed",
};

function phrase(reason: Reason, appEnv: string): string {
  return reason === "app_env" ? `APP_ENV is ${appEnv}` : PHRASES[reason];
}

type ResetInput = Parameters<typeof resetDevelopmentDatabase>[0];
type ResetDeps = Parameters<typeof resetDevelopmentDatabase>[1];

const LOCAL_URL = "postgres://postgres:postgres@localhost:5432/postgres";
const REMOTE_URL = "postgres://postgres:postgres@db.example.com:5432/postgres";

function resetInput(appEnv: ResetInput["appEnv"], host: string): ResetInput {
  return {
    appEnv,
    superuserUrl: `postgres://postgres:postgres@${host}:5432/postgres`,
    databaseName: "budmon",
    migratorPassword: "migrator-password",
    roleSecrets: testRoleSecrets(),
    seed: true,
  };
}

function fakeResetDeps(): {
  runSchemaStep: Mock<ResetDeps["runSchemaStep"]>;
  seed: Mock<ResetDeps["seed"]>;
} {
  return { runSchemaStep: vi.fn<ResetDeps["runSchemaStep"]>(), seed: vi.fn<ResetDeps["seed"]>() };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** Narrows to ResetRefusedError, failing the test otherwise. */
function refused(error: unknown): ResetRefusedError {
  expect(error).toBeInstanceOf(ResetRefusedError);
  if (!(error instanceof ResetRefusedError)) throw new Error("not a ResetRefusedError");
  return error;
}

/** The parts of a URL a refusal must never repeat (A-84). */
function urlSecrets(superuserUrl: string): string[] {
  const parts = ["db.example.com", "10.0.0.5", "/var/run/postgresql", "%2Fvar%2Frun"];
  return parts.filter((part) => superuserUrl.includes(part));
}

beforeEach(() => {
  vi.stubEnv("TESTCONTAINERS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface RefusalCase {
  label: string;
  appEnv: ResetInput["appEnv"];
  superuserUrl: string;
  allowNonLocalHost?: boolean;
  testcontainers?: boolean;
  reason: Reason;
}

// TP-2.16 (a): the nine inputs in the LLD's order, each with its A-84 reason.
const TP_2_16_A: RefusalCase[] = [
  {
    label: 'appEnv "production" on localhost',
    appEnv: "production",
    superuserUrl: LOCAL_URL,
    reason: "app_env",
  },
  {
    label: "host db.example.com with TESTCONTAINERS=1 in the environment (A-79)",
    appEnv: "development",
    superuserUrl: REMOTE_URL,
    testcontainers: true,
    reason: "non_local_host",
  },
  {
    label: 'appEnv "production" with allowNonLocalHost: true (A-79)',
    appEnv: "production",
    superuserUrl: LOCAL_URL,
    allowNonLocalHost: true,
    reason: "app_env",
  },
  {
    label: "?host=db.example.com with allowNonLocalHost: true (A-79)",
    appEnv: "development",
    superuserUrl: "postgres://u:p@localhost/postgres?host=db.example.com",
    allowNonLocalHost: true,
    reason: "host_parameter",
  },
  {
    label: "host db.example.com in development",
    appEnv: "development",
    superuserUrl: REMOTE_URL,
    reason: "non_local_host",
  },
  {
    label: "?host=db.example.com (A-74)",
    appEnv: "development",
    superuserUrl: "postgres://u:p@localhost/postgres?host=db.example.com",
    reason: "host_parameter",
  },
  {
    label: "?hostaddr=10.0.0.5 (A-74)",
    appEnv: "development",
    superuserUrl: "postgres://u:p@localhost/postgres?hostaddr=10.0.0.5",
    reason: "host_parameter",
  },
  {
    label: "a host list (A-74)",
    appEnv: "development",
    superuserUrl: "postgres://u:p@localhost,db.example.com/postgres",
    reason: "host_list",
  },
  {
    label: "a socket path (A-74)",
    appEnv: "development",
    superuserUrl: "postgres://u:p@%2Fvar%2Frun%2Fpostgresql/postgres",
    reason: "socket_path",
  },
];

// TP-2.69x: the sixth reason, which TP-2.16 has no input for. pg-connection-string's parse
// throws "Invalid URL" on an unclosed IPv6 bracket.
const UNPARSEABLE: RefusalCase = {
  label: "an unparseable URL",
  appEnv: "development",
  superuserUrl: "postgres://u:p@[bad/postgres",
  reason: "unparseable_url",
};

function arrange(c: RefusalCase): void {
  if (c.testcontainers === true) vi.stubEnv("TESTCONTAINERS", "1");
}

function resetCall(c: RefusalCase): ResetInput {
  return {
    ...resetInput(c.appEnv, "localhost"),
    superuserUrl: c.superuserUrl,
    ...(c.allowNonLocalHost === undefined ? {} : { allowNonLocalHost: c.allowNonLocalHost }),
  };
}

describe("TP-2.16 (a): resetDevelopmentDatabase refuses before any connection", () => {
  it("TP-2.16 (a): has nine refusal inputs", () => {
    expect(TP_2_16_A).toHaveLength(9);
  });

  it.each(TP_2_16_A.map((c) => [c.label, c] as const))(
    "TP-2.16 (a): %s throws ResetRefusedError with its reason and calls no dependency",
    async (_label, c) => {
      arrange(c);
      const deps = fakeResetDeps();

      const error = refused(await rejection(resetDevelopmentDatabase(resetCall(c), deps)));

      expect(error.reason).toBe(c.reason);
      expect(error.message).toBe(`${RESET_BASE}: ${phrase(c.reason, c.appEnv)}`);
      for (const part of urlSecrets(c.superuserUrl)) expect(error.message).not.toContain(part);
      expect(deps.runSchemaStep).not.toHaveBeenCalled();
      expect(deps.seed).not.toHaveBeenCalled();
    },
  );

  it("TP-2.16 (a): the reasons come out in the LLD's input order", async () => {
    const reasons: unknown[] = [];
    for (const c of TP_2_16_A) {
      arrange(c);
      const error = refused(
        await rejection(resetDevelopmentDatabase(resetCall(c), fakeResetDeps())),
      );
      reasons.push(error.reason);
      vi.unstubAllEnvs();
    }

    expect(reasons).toEqual([
      "app_env",
      "non_local_host",
      "app_env",
      "host_parameter",
      "non_local_host",
      "host_parameter",
      "host_parameter",
      "host_list",
      "socket_path",
    ]);
  });

  it("TP-2.69x: an unparseable URL is refused with reason unparseable_url", async () => {
    const deps = fakeResetDeps();

    const error = refused(await rejection(resetDevelopmentDatabase(resetCall(UNPARSEABLE), deps)));

    expect(error.reason).toBe("unparseable_url");
    expect(error.message).toBe(`${RESET_BASE}: the URL can't be parsed`);
    expect(error.message).not.toContain("[bad");
    expect(deps.runSchemaStep).not.toHaveBeenCalled();
    expect(deps.seed).not.toHaveBeenCalled();
  });

  it("TP-2.67x: allowNonLocalHost: false, given explicitly, still refuses db.example.com", async () => {
    const deps = fakeResetDeps();

    const error = refused(
      await rejection(
        resetDevelopmentDatabase(
          { ...resetInput("development", "db.example.com"), allowNonLocalHost: false },
          deps,
        ),
      ),
    );

    expect(error.reason).toBe("non_local_host");
    expect(deps.runSchemaStep).not.toHaveBeenCalled();
  });

  it("TP-2.45x: appEnv rehearsal is refused with reason app_env", async () => {
    const deps = fakeResetDeps();

    const error = refused(
      await rejection(resetDevelopmentDatabase(resetInput("rehearsal", "localhost"), deps)),
    );

    expect(error.reason).toBe("app_env");
    expect(error.message).toBe(`${RESET_BASE}: APP_ENV is rehearsal`);
    expect(deps.runSchemaStep).not.toHaveBeenCalled();
  });
});

describe("TP-2.24: seedDevelopmentDatabase", () => {
  function seedInput(appEnv: string, host: string) {
    return {
      appEnv: appEnv as ResetInput["appEnv"],
      superuserUrl: `postgres://postgres:postgres@${host}:5432/postgres`,
    };
  }

  it("TP-2.24 (a): development on localhost calls seed once", async () => {
    const seed = vi.fn(() => Promise.resolve());

    await seedDevelopmentDatabase(seedInput("development", "localhost"), { seed });

    expect(seed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["(b) production on localhost", "production", "localhost", false, "app_env"],
    ["(c) development on db.example.com", "development", "db.example.com", false, "non_local_host"],
    [
      "(c) development on db.example.com, with TESTCONTAINERS=1 (A-79)",
      "development",
      "db.example.com",
      true,
      "non_local_host",
    ],
  ] as const)(
    "TP-2.24 %s throws ResetRefusedError with the db:seed message and doesn't seed",
    async (_label, appEnv, host, testcontainers, reason) => {
      if (testcontainers) vi.stubEnv("TESTCONTAINERS", "1");
      const seed = vi.fn(() => Promise.resolve());

      const error = refused(
        await rejection(seedDevelopmentDatabase(seedInput(appEnv, host), { seed })),
      );

      expect(error.message.startsWith(`${SEED_BASE}: `)).toBe(true);
      expect(error.reason).toBe(reason);
      expect(error.message).toBe(`${SEED_BASE}: ${phrase(reason, appEnv)}`);
      expect(error.message).not.toContain("db.example.com");
      expect(seed).not.toHaveBeenCalled();
    },
  );

  it("TP-2.24 (d): a failing seed rejects with that error", async () => {
    const failure = new Error("x");
    const seed = vi.fn(() => Promise.reject(failure));

    const error = await rejection(
      seedDevelopmentDatabase(seedInput("development", "localhost"), { seed }),
    );

    expect(error).toBe(failure);
  });

  it.each([["127.0.0.1"], ["[::1]"], ["host.docker.internal"]])(
    "TP-2.45x: the local host %s is allowed in test",
    async (host) => {
      const seed = vi.fn(() => Promise.resolve());

      await seedDevelopmentDatabase(seedInput("test", host), { seed });

      expect(seed).toHaveBeenCalledTimes(1);
    },
  );

  it.each([["development"], ["test"]])(
    "TP-2.67x: allowNonLocalHost: true lets %s seed on db.example.com",
    async (appEnv) => {
      const seed = vi.fn(() => Promise.resolve());

      await seedDevelopmentDatabase(
        { ...seedInput(appEnv, "db.example.com"), allowNonLocalHost: true },
        { seed },
      );

      expect(seed).toHaveBeenCalledTimes(1);
    },
  );

  it("TP-2.67x: allowNonLocalHost: true doesn't allow production", async () => {
    const seed = vi.fn(() => Promise.resolve());

    const error = refused(
      await rejection(
        seedDevelopmentDatabase(
          { ...seedInput("production", "db.example.com"), allowNonLocalHost: true },
          { seed },
        ),
      ),
    );

    expect(error.reason).toBe("app_env");
    expect(error.message).toBe(`${SEED_BASE}: APP_ENV is production`);
    expect(seed).not.toHaveBeenCalled();
  });

  // TP-2.69x: the seed path refuses the A-74 inputs and an unparseable URL with the same reasons.
  it.each([...TP_2_16_A.slice(5), UNPARSEABLE].map((c) => [c.label, c] as const))(
    "TP-2.69x: seedDevelopmentDatabase with %s throws ResetRefusedError with its reason and doesn't seed",
    async (_label, c) => {
      const seed = vi.fn(() => Promise.resolve());

      const error = refused(
        await rejection(
          seedDevelopmentDatabase({ appEnv: c.appEnv, superuserUrl: c.superuserUrl }, { seed }),
        ),
      );

      expect(error.reason).toBe(c.reason);
      expect(error.message).toBe(`${SEED_BASE}: ${phrase(c.reason, c.appEnv)}`);
      expect(seed).not.toHaveBeenCalled();
    },
  );
});

// TP-2.16 (A-93), direct: F-20 applies the rule itself, since its input type can be bypassed.
describe("TP-2.16 (A-93): F-20 refuses an unknown appEnv without repeating it", () => {
  it.each([["secret\nINJECTED"], ["staging"]])(
    "TP-2.16: resetDevelopmentDatabase with appEnv %j refuses with the fixed phrase",
    async (appEnv) => {
      const deps = fakeResetDeps();

      const error = refused(
        await rejection(
          resetDevelopmentDatabase(
            { ...resetInput("development", "localhost"), appEnv: appEnv as ResetInput["appEnv"] },
            deps,
          ),
        ),
      );

      expect(error.reason).toBe("app_env");
      expect(error.message).toBe(`${RESET_BASE}: APP_ENV is not a known environment`);
      expect(error.message).not.toContain(appEnv.split("\n")[0] ?? appEnv);
      expect(error.message).not.toContain("INJECTED");
      expect(deps.runSchemaStep).not.toHaveBeenCalled();
      expect(deps.seed).not.toHaveBeenCalled();
    },
  );

  it.each([["secret\nINJECTED"], ["staging"], [""]])(
    "TP-2.78x: seedDevelopmentDatabase with appEnv %j refuses with the db:seed fixed phrase",
    async (appEnv) => {
      const seed = vi.fn(() => Promise.resolve());

      const error = refused(
        await rejection(
          seedDevelopmentDatabase(
            { appEnv: appEnv as ResetInput["appEnv"], superuserUrl: LOCAL_URL },
            { seed },
          ),
        ),
      );

      expect(error.reason).toBe("app_env");
      expect(error.message).toBe(`${SEED_BASE}: APP_ENV is not a known environment`);
      expect(seed).not.toHaveBeenCalled();
    },
  );
});

// TP-2.16 (A-96): URLs the parser can't turn into a single host are unparseable_url, which takes
// precedence over host_list, socket_path and host_parameter.
describe("TP-2.16 (A-96): multi-host authorities and an empty host are unparseable_url", () => {
  it.each([
    ["a host list with ports", "postgres://u:p@localhost:5432,db.example.com:5432/postgres"],
    ["an empty host with ?host=/path", "postgres://u:p@/postgres?host=/path"],
  ])("TP-2.16: %s is refused with reason unparseable_url", async (_label, superuserUrl) => {
    const deps = fakeResetDeps();

    const error = refused(
      await rejection(
        resetDevelopmentDatabase({ ...resetInput("development", "localhost"), superuserUrl }, deps),
      ),
    );

    expect(error.reason).toBe("unparseable_url");
    expect(error.message).toBe(`${RESET_BASE}: the URL can't be parsed`);
    expect(error.message).not.toContain("db.example.com");
    expect(deps.runSchemaStep).not.toHaveBeenCalled();
    expect(deps.seed).not.toHaveBeenCalled();
  });

  it("TP-2.82x: app_env still comes first for an unparseable URL (A-96 precedence)", async () => {
    const deps = fakeResetDeps();

    const error = refused(
      await rejection(
        resetDevelopmentDatabase(
          {
            ...resetInput("production", "localhost"),
            superuserUrl: "postgres://u:p@[bad/postgres",
          },
          deps,
        ),
      ),
    );

    expect(error.reason).toBe("app_env");
  });
});
