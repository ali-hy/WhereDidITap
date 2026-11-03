// F-8 checkApiMinor. TP-4.6, plus extra cases TP-4.35x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { checkApiMinor } from "../checkApiMinor.js";

const MESSAGE = "The contract changed; bump API_MINOR in packages/contract/src/common/version.ts";

function doc(
  version: string,
  paths: Record<string, unknown> = { "/meta/client-config": { get: {} } },
) {
  return { openapi: "3.1.1", info: { title: "Budmon API", version }, paths };
}

const CHANGED_PATHS = { "/meta/client-config": { get: {} }, "/things": { get: {} } };

describe("TP-4.6: checkApiMinor", () => {
  it("TP-4.6: the same content is ok", () => {
    expect(checkApiMinor({ baseOpenapi: doc("1.0"), headOpenapi: doc("1.0") }).ok).toBe(true);
  });

  it("TP-4.6: changed content with the minor bumped 0 to 1 is ok", () => {
    expect(
      checkApiMinor({ baseOpenapi: doc("1.0"), headOpenapi: doc("1.1", CHANGED_PATHS) }).ok,
    ).toBe(true);
  });

  it("TP-4.6: changed content with the minor unchanged is not ok, with F-8's message", () => {
    expect(
      checkApiMinor({ baseOpenapi: doc("1.0"), headOpenapi: doc("1.0", CHANGED_PATHS) }),
    ).toEqual({ ok: false, message: MESSAGE });
  });
});

describe("TP-4.35x: checkApiMinor, further cases (F-8)", () => {
  it("TP-4.35x: identical documents with a different version are ok (info.version is ignored)", () => {
    expect(checkApiMinor({ baseOpenapi: doc("1.3"), headOpenapi: doc("1.0") }).ok).toBe(true);
  });

  it.each([["1.0"], ["1.2"], ["2.3"], ["1.x"], ["v1.4"]])(
    "TP-4.35x: changed content with head version %s against base 1.3 is not ok",
    (version) => {
      expect(
        checkApiMinor({ baseOpenapi: doc("1.3"), headOpenapi: doc(version, CHANGED_PATHS) }).ok,
      ).toBe(false);
    },
  );

  it("TP-4.35x: changed content with the minor jumping by more than one is ok", () => {
    expect(
      checkApiMinor({ baseOpenapi: doc("1.3"), headOpenapi: doc("1.5", CHANGED_PATHS) }).ok,
    ).toBe(true);
  });
});
