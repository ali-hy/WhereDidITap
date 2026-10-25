// F-218 announce: the visually hidden live regions, cleared before each announcement so the same
// text twice is announced twice (N-1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadA11y } from "../support/s11b.js";

beforeEach(() => {
  for (const id of ["live-polite", "live-assertive"]) document.getElementById(id)?.remove();
});

const text = (id: string) => document.getElementById(id)?.textContent;

describe("TP-11.34x: announce (F-218)", () => {
  it("TP-11.34x: announce writes to #live-polite (aria-live polite, aria-atomic true)", async () => {
    const { announce } = await loadA11y();

    announce("Budget saved");

    const el = document.getElementById("live-polite");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    expect(el?.getAttribute("aria-atomic")).toBe("true");
    await vi.waitFor(() => {
      expect(text("live-polite")).toBe("Budget saved");
    });
  });

  it("TP-11.34x: assertive goes to #live-assertive only", async () => {
    const { announce } = await loadA11y();

    announce("Couldn't save", "assertive");

    await vi.waitFor(() => {
      expect(text("live-assertive")).toBe("Couldn't save");
    });
    expect(text("live-polite") ?? "").toBe("");
  });

  it("TP-11.34x (N-1): the same text again clears the region first, then refills it", async () => {
    const { announce } = await loadA11y();
    announce("Saved");
    await vi.waitFor(() => {
      expect(text("live-polite")).toBe("Saved");
    });
    const el = document.getElementById("live-polite") as HTMLElement;
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(el.textContent);
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });

    announce("Saved");
    await vi.waitFor(() => {
      expect(seen.at(-1)).toBe("Saved");
    });
    observer.disconnect();

    expect(seen[0]).toBe("");
  });
});
