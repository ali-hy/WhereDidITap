// F-50 BudmonError (moved to S-3 by A-100). TP-4.18, plus extra cases TP-3.30x (the fields, the
// default message, the subclass name and the bounds of the key and status rules).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { BudmonError } from "../../../src/platform/errors/BudmonError.js";

describe("TP-4.18: invalid BudmonError construction", () => {
  it('TP-4.18: new BudmonError("bad key", 400) throws TypeError', () => {
    expect(() => new BudmonError("bad key", 400)).toThrow(TypeError);
  });

  it('TP-4.18: new BudmonError("OK_KEY", 200) throws TypeError', () => {
    expect(() => new BudmonError("OK_KEY", 200)).toThrow(TypeError);
  });
});

describe("TP-3.30x: BudmonError, further cases (F-50)", () => {
  it("TP-3.30x: key, status, details and message are set; message defaults to the key", () => {
    const err = new BudmonError("NOT_FOUND", 404);
    const detailed = new BudmonError("CONFLICT", 409, "already exists", { field: "name" });

    expect(err).toBeInstanceOf(Error);
    expect([err.key, err.status, err.message, err.details]).toEqual([
      "NOT_FOUND",
      404,
      "NOT_FOUND",
      undefined,
    ]);
    expect([detailed.message, detailed.details]).toEqual(["already exists", { field: "name" }]);
  });

  it("TP-3.30x: name is the subclass name", () => {
    class LedgerLockedError extends BudmonError {
      constructor() {
        super("LEDGER_LOCKED", 423);
      }
    }

    expect(new BudmonError("NOT_FOUND", 404).name).toBe("BudmonError");
    expect(new LedgerLockedError().name).toBe("LedgerLockedError");
  });

  it.each([
    ["2 characters", "AB"],
    ["64 characters", `A${"B".repeat(63)}`],
    ["digits and underscores", "E2_X9"],
  ])("TP-3.30x: a key of %s is accepted", (_label, key) => {
    expect(new BudmonError(key, 400).key).toBe(key);
  });

  it.each([
    ["1 character", "A"],
    ["65 characters", `A${"B".repeat(64)}`],
    ["lower case", "not_found"],
    ["a leading digit", "1ABC"],
    ["a leading underscore", "_ABC"],
    ["a hyphen", "NOT-FOUND"],
    ["empty", ""],
  ])("TP-3.30x: a key of %s throws TypeError", (_label, key) => {
    expect(() => new BudmonError(key, 400)).toThrow(TypeError);
  });

  it.each([[400], [499], [500], [599]])("TP-3.30x: status %i is accepted", (status) => {
    expect(new BudmonError("OK_KEY", status).status).toBe(status);
  });

  it.each([[399], [600], [404.5], [Number.NaN]])(
    "TP-3.30x: status %d throws TypeError",
    (status) => {
      expect(() => new BudmonError("OK_KEY", status)).toThrow(TypeError);
    },
  );
});
