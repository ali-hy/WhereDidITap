// F-26 describeFailure (A-81). TP-2.36, plus extra cases TP-2.72x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { CANARIES } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { SchemaStepError } from "../../../src/platform/db/schemaStepError.js";
import { ResetRefusedError, seedDevelopmentDatabase } from "../../../src/platform/db/reset.js";
import { describeFailure } from "../../../src/platform/observability/describeFailure.js";

const CANARY_TOKEN = CANARIES.token;

/** F-30's `token` rule: what every value in the result must match. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

function withCode(message: string, code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code }, extra);
}

/** A real ResetRefusedError with reason host_list, from F-20's own guard. */
async function hostListRefusal(): Promise<ResetRefusedError> {
  try {
    await seedDevelopmentDatabase(
      { appEnv: "development", superuserUrl: "postgres://u:p@localhost,db.example.com/postgres" },
      { seed: () => Promise.resolve() },
    );
  } catch (error) {
    if (error instanceof ResetRefusedError) return error;
    throw error;
  }
  throw new Error("expected a ResetRefusedError");
}

function expectTokens(result: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(result)) {
    expect(value, key).toMatch(TOKEN);
  }
}

describe("TP-2.36: describeFailure", () => {
  it("TP-2.36: a SchemaStepError gives its class, code and subject", () => {
    const result = describeFailure(new SchemaStepError("invalid_verifier", "budmon_app"));

    expect(result).toEqual({
      errorClass: "SchemaStepError",
      errorCode: "invalid_verifier",
      reason: "budmon_app",
    });
  });

  it("TP-2.36: a pg error with SQLSTATE 28P01 gives errorCode 28P01 and no trace of its message", () => {
    const result = describeFailure(withCode(CANARY_TOKEN, "28P01"));

    expect(result).toEqual({ errorClass: "Error", errorCode: "28P01" });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  it("TP-2.36: a system error ECONNREFUSED gives errorCode ECONNREFUSED and no IP address", () => {
    const err = withCode("connect ECONNREFUSED 10.1.2.3:5432", "ECONNREFUSED", {
      errno: -111,
      syscall: "connect",
      address: "10.1.2.3",
      port: 5432,
    });

    const result = describeFailure(err);

    expect(result).toEqual({ errorClass: "Error", errorCode: "ECONNREFUSED" });
    expect(JSON.stringify(result)).not.toContain("10.1.2.3");
    expect(JSON.stringify(result)).not.toContain("5432");
  });

  it("TP-2.36: a ResetRefusedError gives its reason", async () => {
    const result = describeFailure(await hostListRefusal());

    expect(result).toEqual({ errorClass: "ResetRefusedError", reason: "host_list" });
  });

  it('TP-2.36: a thrown string "x" is a NonError', () => {
    expect(describeFailure("x")).toEqual({ errorClass: "NonError" });
  });

  it('TP-2.36: a code that fails the token rule ("has space") is left out', () => {
    const result = describeFailure(withCode("m", "has space"));

    expect(result).toEqual({ errorClass: "Error" });
    expect(result).not.toHaveProperty("errorCode");
  });
});

describe("TP-2.72x: describeFailure, further cases (A-81)", () => {
  it("TP-2.72x: the class is the error's constructor name", () => {
    class TimeoutFailure extends Error {}

    expect(describeFailure(new TimeoutFailure("m"))).toEqual({ errorClass: "TimeoutFailure" });
  });

  it.each([[null], [undefined], [42], [{ code: "28P01", message: "m" }]])(
    "TP-2.72x: a non-Error value (%o) is a NonError",
    (value) => {
      expect(describeFailure(value).errorClass).toBe("NonError");
    },
  );

  it("TP-2.72x: a SchemaStepError without a subject has no reason", () => {
    expect(describeFailure(new SchemaStepError("invalid_verifier"))).toEqual({
      errorClass: "SchemaStepError",
      errorCode: "invalid_verifier",
    });
  });

  it("TP-2.72x: a SchemaStepError subject that fails the token rule is left out", () => {
    const result = describeFailure(new SchemaStepError("invalid_verifier", "has space"));

    expect(result).toEqual({ errorClass: "SchemaStepError", errorCode: "invalid_verifier" });
  });

  it.each([
    ["a lower-case code", "econnrefused"],
    ["a 6-character SQLSTATE", "28P01X"],
    ["a 4-character SQLSTATE", "28P0"],
    ["an E code over 31 characters", `E${"A".repeat(31)}`],
    ["a code holding the canary", CANARY_TOKEN],
  ])("TP-2.72x: %s is not an errorCode", (_label, code) => {
    expect(describeFailure(withCode("m", code))).toEqual({ errorClass: "Error" });
  });

  it.each([
    ["the longest system code", `E${"A".repeat(30)}`],
    ["a system code with digits and underscores", "ERR_SOCKET_1"],
    ["a numeric SQLSTATE", "57014"],
  ])("TP-2.72x: %s is an errorCode", (_label, code) => {
    expect(describeFailure(withCode("m", code))).toEqual({ errorClass: "Error", errorCode: code });
  });

  it("TP-2.72x: the message, cause and stack never reach the result", () => {
    const err = new Error(`password ${CANARY_TOKEN}`, { cause: new Error(CANARY_TOKEN) });
    err.stack = `Error: ${CANARY_TOKEN}\n    at x (/home/${CANARY_TOKEN}.ts:1:1)`;

    const result = describeFailure(err);

    expect(result).toEqual({ errorClass: "Error" });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  it("TP-2.72x: every value in a full result passes F-30's token rule", async () => {
    expectTokens(describeFailure(new SchemaStepError("role_attributes_unexpected", "budmon_app")));
    expectTokens(describeFailure(await hostListRefusal()));
    expectTokens(describeFailure(withCode("m", "ECONNRESET")));
  });
});
