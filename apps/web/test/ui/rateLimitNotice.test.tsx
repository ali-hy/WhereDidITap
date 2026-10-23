// F-214 the rate-limit gate and notice (J-3, A-191). TP-11.10, with A-400 (the status element is
// always rendered) and A-404 (a 429 without retryAfterSeconds blocks for 60 s).
import { screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RateLimitModule, loadRateLimit, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-07T12:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

function form(m: RateLimitModule) {
  let gate: ReturnType<RateLimitModule["createRateLimitGate"]> | undefined;
  renderWithI18n(() => {
    gate = m.createRateLimitGate(() => Date.now());
    const g = gate;
    return (
      <form>
        {/* A-400: the notice is rendered whenever the form has a gate. */}
        <m.RateLimitNotice secondsLeft={g.blockedFor()} />
        <button type="submit" disabled={g.blockedFor() > 0}>
          Save
        </button>
      </form>
    );
  });
  if (gate === undefined) throw new Error("no gate");
  return gate;
}

const submit = () => screen.getByRole<HTMLButtonElement>("button", { name: "Save" });

describe("TP-11.10: a rate-limited form (F-214)", () => {
  it("TP-11.10 (A-324): block(125): Try again in 3 minutes in role=status and submit disabled; at 61 s left 2 minutes; at 60 s left 1 minute; 60 s later enabled", async () => {
    const m = await loadRateLimit();
    const gate = form(m);
    expect(submit().disabled).toBe(false);

    gate.block(125);
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.blockedFor()).toBe(125);
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Too many attempts. Try again in 3 minutes.",
    );
    expect(submit().disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(64_000);
    expect(gate.blockedFor()).toBe(61);
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Too many attempts. Try again in 2 minutes.",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gate.blockedFor()).toBe(60);
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Too many attempts. Try again in 1 minute.",
    );
    expect(submit().disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(gate.blockedFor()).toBe(0);
    expect(submit().disabled).toBe(false);
  });

  it("TP-11.10: blockedFor counts down each second to 0", async () => {
    const m = await loadRateLimit();
    await createRoot(async (dispose) => {
      const gate = m.createRateLimitGate(() => Date.now());
      gate.block(3);
      const seen: number[] = [gate.blockedFor()];
      for (let i = 0; i < 4; i += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
        seen.push(gate.blockedFor());
      }
      dispose();

      expect(seen).toEqual([3, 2, 1, 0, 0]);
    });
  });

  it("TP-11.10 (A-400): with a gate not blocked, an empty role=status element is present", async () => {
    const m = await loadRateLimit();
    form(m);
    await vi.advanceTimersByTimeAsync(0);

    expect(plain(screen.getByRole("status").textContent)).toBe("");
    expect(submit().disabled).toBe(false);
  });

  it("TP-11.10 (A-404): block(undefined) (a 429 without retryAfterSeconds) shows Try again in 1 minute for 60 s", async () => {
    const m = await loadRateLimit();
    const gate = form(m);

    // F-214's signature takes a number; A-404 has block fall back to 60 s when the value is missing.
    gate.block(undefined as unknown as number);
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.blockedFor()).toBe(60);
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Too many attempts. Try again in 1 minute.",
    );
    expect(submit().disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(submit().disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gate.blockedFor()).toBe(0);
    expect(submit().disabled).toBe(false);
  });
});

describe("TP-11.10 (A-461): a shorter block never shortens the wait", () => {
  it("TP-11.10 (A-461): block(300), 10 s, block(60): blockedFor() is 290; then block(600): 600", async () => {
    const m = await loadRateLimit();
    await createRoot(async (dispose) => {
      const gate = m.createRateLimitGate(() => Date.now());
      gate.block(300);
      await vi.advanceTimersByTimeAsync(10_000);

      gate.block(60);
      const afterShorter = gate.blockedFor();
      gate.block(600);
      const afterLonger = gate.blockedFor();
      dispose();

      expect(afterShorter).toBe(290);
      expect(afterLonger).toBe(600);
    });
  });
});
