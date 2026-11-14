// F-211 OfflineBanner (C-1, web). TP-11.13.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfflineBanner, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function go(state: boolean): Promise<void> {
  online = state;
  window.dispatchEvent(new Event(state ? "online" : "offline"));
  await vi.advanceTimersByTimeAsync(0);
}

/** The banner: role=status with aria-live=polite, holding one of the two texts. */
function banner(container: HTMLElement): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>('[role="status"]')].find((el) =>
      /You're offline\.|Back online\./.test(plain(el.textContent)),
    ) ?? null
  );
}

describe("TP-11.13: offline and back online (F-211)", () => {
  it("TP-11.13: offline shows You're offline.; online shows Back online.; 3 s later the banner is hidden", async () => {
    const { OfflineBanner } = await loadOfflineBanner();
    const { container } = renderWithI18n(() => <OfflineBanner />);
    await vi.advanceTimersByTimeAsync(0);
    expect(plain(container.textContent)).not.toMatch(/You're offline\.|Back online\./);

    await go(false);
    const offline = banner(container);
    expect(plain(offline?.textContent)).toContain("You're offline.");
    expect(offline?.getAttribute("aria-live")).toBe("polite");

    await go(true);
    expect(plain(banner(container)?.textContent)).toContain("Back online.");
    expect(plain(container.textContent)).not.toContain("You're offline.");

    await vi.advanceTimersByTimeAsync(2_900);
    expect(plain(container.textContent)).toContain("Back online.");
    await vi.advanceTimersByTimeAsync(200);
    expect(plain(container.textContent)).not.toMatch(/You're offline\.|Back online\./);
  });

  // A-373: the live region is permanent (empty while online), so its first message is announced.
  it("TP-11.13 (A-373): before going offline, the empty role=status region (aria-live polite) is already in the DOM, and stays after Back online. clears", async () => {
    const { OfflineBanner } = await loadOfflineBanner();
    const { container } = renderWithI18n(() => <OfflineBanner />);
    await vi.advanceTimersByTimeAsync(0);

    const regions = [...container.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(plain(region?.textContent)).toBe("");

    await go(false);
    expect(container.querySelector('[role="status"]')).toBe(region);
    await go(true);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(plain(region?.textContent)).toBe("");
  });

  it("TP-11.13: mounted while navigator.onLine is false, the banner shows You're offline.", async () => {
    online = false;
    const { OfflineBanner } = await loadOfflineBanner();
    const { container } = renderWithI18n(() => <OfflineBanner />);
    await vi.advanceTimersByTimeAsync(0);

    expect(plain(banner(container)?.textContent)).toContain("You're offline.");
  });
});
