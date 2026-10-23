// F-223 AppBanners (A-462): one sticky container, the update-required banner before the offline
// status in DOM order, each with its aria-hidden icon. TP-11.34.
import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBanners } from "../../src/ui/AppBanners.js";
import { Icon } from "../../src/ui/icons/Icon.js";
import type { IconName } from "../../src/ui/icons/registry.js";
import { plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

const pathsOf = (svg: Element | null | undefined) =>
  [...(svg?.querySelectorAll("path") ?? [])].map((p) => p.getAttribute("d")).join("|");
function iconPaths(name: IconName): string {
  const { container, unmount } = render(() => <Icon name={name} />);
  const d = pathsOf(container.querySelector("svg"));
  unmount();
  return d;
}

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  // UpdateNotifier's default version check never answers here.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TP-11.34: AppBanners (F-223, A-462)", () => {
  it("TP-11.34: one div[data-banners] with sticky top-0; the role=alert update banner (alert icon) precedes the offline status (offline icon)", async () => {
    const [updateRequired] = createSignal(true);
    const { container } = renderWithI18n(() => (
      <AppBanners buildNumber={1} updateRequired={updateRequired} />
    ));

    const alert = await screen.findByRole("alert");
    const banners = container.querySelectorAll("div[data-banners]");
    expect(banners).toHaveLength(1);
    const box = banners[0] as HTMLElement;
    expect(box.classList.contains("sticky")).toBe(true);
    expect(box.classList.contains("top-0")).toBe(true);

    const offline = [...box.querySelectorAll<HTMLElement>('[role="status"]')].find((el) =>
      plain(el.textContent).includes("You're offline."),
    );
    expect(offline).toBeDefined();
    expect(box.contains(alert)).toBe(true);
    // alert before offline in DOM order.
    expect(
      alert.compareDocumentPosition(offline as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const alertIcon = alert.querySelector("svg");
    expect(alertIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(pathsOf(alertIcon)).toBe(iconPaths("alert"));
    const offlineIcon = offline?.querySelector("svg");
    expect(offlineIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(pathsOf(offlineIcon)).toBe(iconPaths("offline"));
  });
});
