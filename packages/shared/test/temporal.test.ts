// TP-1.14: F-310's Temporal is the polyfill's namespace re-exported (value and types), always the
// polyfill, used from outside the package through `@budmon/shared` (A-34).
// The type assertions are checked by `pnpm typecheck` (tsc); expectTypeOf is a no-op at run time.
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { fixedClock, systemClock, Temporal, todayIn } from "@budmon/shared";

describe("TP-1.14: Temporal from @budmon/shared", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("TP-1.14: the catalog signatures type-check from outside the package", () => {
    const today = todayIn(fixedClock("2026-10-05T22:30:00Z"), "UTC");
    const instant: Temporal.Instant = systemClock.now();

    expectTypeOf(today).toEqualTypeOf<Temporal.PlainDate>();
    expectTypeOf(instant).toEqualTypeOf<Temporal.Instant>();
    expect(today.toString()).toBe("2026-10-05");
    expect(instant).toBeInstanceOf(Temporal.Instant);
  });

  it("TP-1.14: Temporal is the polyfill's export", async () => {
    const polyfill = await import("@js-temporal/polyfill");

    expect(Temporal).toBe(polyfill.Temporal);
  });

  it("TP-1.14: with globalThis.Temporal stubbed before import, Temporal is still the polyfill's", async () => {
    const sentinel = { sentinel: true };
    vi.stubGlobal("Temporal", sentinel);
    vi.resetModules();

    const shared = await import("@budmon/shared");
    const polyfill = await import("@js-temporal/polyfill");

    expect(shared.Temporal).toBe(polyfill.Temporal);
    expect(shared.Temporal).not.toBe(sentinel);
    expect(shared.fixedClock("2026-10-05T22:30:00Z").now()).toBeInstanceOf(
      polyfill.Temporal.Instant,
    );
  });
});
