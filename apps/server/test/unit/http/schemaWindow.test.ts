// F-57 schemaWindow. TP-4.12, plus extra cases TP-4.39x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { schemaWindow } from "../../../src/platform/http/health.js";

const journal = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({ hash: `h${String(i)}`, when: 1_760_000_000_000 + i }));
const applied = (entries: readonly { hash: string; when: number }[]) =>
  entries.map((e) => ({ hash: e.hash, createdAt: e.when }));

describe("TP-4.12: schemaWindow", () => {
  it("TP-4.12: applied equals the journal: ok", () => {
    expect(schemaWindow(applied(journal(3)), journal(3))).toBe("ok");
  });

  it("TP-4.12: one applied entry beyond the journal: ok", () => {
    expect(schemaWindow(applied(journal(4)), journal(3))).toBe("ok");
  });

  it("TP-4.12: two applied entries beyond the journal: ahead", () => {
    expect(schemaWindow(applied(journal(5)), journal(3))).toBe("ahead");
  });

  it("TP-4.12: a journal entry not applied: behind", () => {
    expect(schemaWindow(applied(journal(2)), journal(3))).toBe("behind");
  });
});

describe("TP-4.39x: schemaWindow, further cases (F-57)", () => {
  it("TP-4.39x: both empty: ok", () => {
    expect(schemaWindow([], [])).toBe("ok");
  });

  it("TP-4.39x: a missing journal entry wins over extra applied ones: behind", () => {
    const j = journal(3);
    const a = [...applied(j.slice(1)), { hash: "x1", createdAt: 1 }, { hash: "x2", createdAt: 2 }];

    expect(schemaWindow(a, j)).toBe("behind");
  });

  it("TP-4.39x: a missing entry in the middle of the journal: behind", () => {
    const j = journal(3);

    expect(
      schemaWindow(
        applied(j).filter((e) => e.hash !== "h1"),
        j,
      ),
    ).toBe("behind");
  });
});
