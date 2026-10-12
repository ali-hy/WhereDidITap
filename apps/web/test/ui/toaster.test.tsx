// F-212 toasts (Kobalte's Toast region). TP-11.29, with A-400 (announced through F-218's permanent
// regions; the toasts themselves are aria-live="off") and B-4 (hover and focus pause independently).
import { fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadToaster } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

beforeEach(() => {
  vi.useFakeTimers();
  // F-218 appends its regions to body; each test starts without them.
  for (const id of ["live-polite", "live-assertive"]) document.getElementById(id)?.remove();
});
afterEach(async () => {
  // The toaster's store is module-level: let this test's non-persistent toasts expire so they
  // don't hold places under Kobalte's visible limit in the next test.
  await vi.advanceTimersByTimeAsync(60_000);
  vi.useRealTimers();
});

async function mount() {
  const m = await loadToaster();
  renderWithI18n(() => <m.Toaster />);
  return m;
}

const live = (el: HTMLElement) => el.closest("[aria-live]")?.getAttribute("aria-live");
const region = (id: "live-polite" | "live-assertive") => document.getElementById(id)?.textContent;

/** The toast element holding `text` (not F-218's live regions), or null. */
const shown = (text: string) =>
  screen
    .queryAllByText(text, { exact: false })
    .find((el) => el.closest("#live-polite, #live-assertive") === null) ?? null;

describe("TP-11.29: toasts (F-212)", () => {
  it("TP-11.29 (A-400): an info toast is aria-live off and announced in #live-polite; hovered, it stays past 7 s; after the pointer leaves, it closes within 6 s", async () => {
    const { showToast } = await mount();

    showToast({ message: "Saved the budget", tone: "info" });
    await vi.advanceTimersByTimeAsync(0);
    const toast = shown("Saved the budget");
    expect(toast).not.toBeNull();
    expect(live(toast as HTMLElement)).toBe("off");
    await vi.waitFor(() => {
      expect(region("live-polite")).toBe("Saved the budget");
    });

    const target = toast as HTMLElement;
    fireEvent.pointerEnter(target);
    fireEvent.pointerMove(target);
    fireEvent.mouseEnter(target);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(shown("Saved the budget")).not.toBeNull();

    fireEvent.pointerLeave(target);
    fireEvent.mouseLeave(target);
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(500);
    expect(shown("Saved the budget")).toBeNull();
  });

  it("TP-11.29: an un-hovered info toast closes after 6 s", async () => {
    const { showToast } = await mount();

    showToast({ message: "Copied", tone: "success" });
    await vi.advanceTimersByTimeAsync(5_500);
    expect(shown("Copied")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shown("Copied")).toBeNull();
  });

  it("TP-11.29 (A-400): tone error is announced in #live-assertive; the toast stays aria-live off", async () => {
    const { showToast } = await mount();

    showToast({ message: "Couldn't save", tone: "error" });
    await vi.advanceTimersByTimeAsync(0);
    const toast = shown("Couldn't save");

    expect(toast).not.toBeNull();
    expect(live(toast as HTMLElement)).toBe("off");
    await vi.waitFor(() => {
      expect(region("live-assertive")).toBe("Couldn't save");
    });
    expect(region("live-polite") ?? "").not.toContain("Couldn't save");
  });

  it("TP-11.29 (A-400): every live attribute in the toast region is off (the region and each toast)", async () => {
    const { showToast } = await mount();

    showToast({ message: "One", tone: "info" });
    showToast({ message: "Two", tone: "error" });
    await vi.advanceTimersByTimeAsync(0);

    const values = [...document.querySelectorAll("[aria-live]")]
      .filter((el) => el.id !== "live-polite" && el.id !== "live-assertive")
      .map((el) => el.getAttribute("aria-live"));
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values)).toEqual(new Set(["off"]));
  });

  it("TP-11.29 (B-4): focus inside a toast pauses it past 7 s; after focus leaves, it closes within 6 s", async () => {
    const { showToast } = await mount();

    showToast({
      message: "Focus holds",
      tone: "info",
      action: { label: "Undo", onClick: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    const button = screen.getByRole("button", { name: "Undo" });
    fireEvent.focusIn(button);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(shown("Focus holds")).not.toBeNull();

    fireEvent.focusOut(button);
    await vi.advanceTimersByTimeAsync(6_500);
    expect(shown("Focus holds")).toBeNull();
  });

  it("TP-11.29 (B-4): hovered and focused, leaving with the pointer keeps it paused while focus stays", async () => {
    const { showToast } = await mount();

    showToast({
      message: "Both hold",
      tone: "info",
      action: { label: "Open", onClick: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    const button = screen.getByRole("button", { name: "Open" });
    fireEvent.pointerEnter(button);
    fireEvent.mouseEnter(button);
    fireEvent.focusIn(button);
    fireEvent.pointerLeave(button);
    fireEvent.mouseLeave(button);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(shown("Both hold")).not.toBeNull();

    fireEvent.focusOut(button);
    await vi.advanceTimersByTimeAsync(6_500);
    expect(shown("Both hold")).toBeNull();
  });

  it("TP-11.29: a persistent toast is still shown after 60 s; dismissToast(id) removes it", async () => {
    const { showToast, dismissToast } = await mount();

    const id = showToast({ message: "Stays put", tone: "info", persistent: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shown("Stays put")).not.toBeNull();

    dismissToast(id);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shown("Stays put")).toBeNull();
  });

  it("TP-11.29: an action renders as a button calling onClick", async () => {
    const { showToast } = await mount();
    const onClick = vi.fn();

    showToast({ message: "Updated", tone: "info", action: { label: "Reload", onClick } });
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
