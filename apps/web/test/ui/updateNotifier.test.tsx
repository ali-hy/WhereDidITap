// F-210 UpdateNotifier (J-6). TP-11.11 and TP-11.12 (a) (A-325). The cases that
// show a toast run last: F-212's toasts live in a module-level store shared by the cases.
import { screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadToaster, loadUpdateNotifier, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

const AVAILABLE = "Budmon has been updated. Reload to get the latest version.";

afterEach(() => {
  vi.restoreAllMocks();
});

async function mount(fetchVersion: () => Promise<{ buildNumber: number }>) {
  const { UpdateNotifier } = await loadUpdateNotifier();
  const { Toaster } = await loadToaster();
  let clock = Date.parse("2026-10-07T12:00:00Z");
  const scheduled: { fn: () => void; ms: number }[] = [];
  const fetchSpy = vi.fn(fetchVersion);
  const result = renderWithI18n(() => (
    <>
      <UpdateNotifier
        buildNumber={7}
        fetchVersion={fetchSpy}
        now={() => clock}
        schedule={(fn, ms) => {
          scheduled.push({ fn, ms });
          return () => undefined;
        }}
      />
      <Toaster />
    </>
  ));
  return {
    ...result,
    fetchSpy,
    scheduled,
    advance(ms: number) {
      clock += ms;
    },
    async focus() {
      window.dispatchEvent(new Event("focus"));
      // Let the fetch and the render settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("TP-11.11: new web build toast (F-210)", () => {
  it("TP-11.11: /version.json 7 shows nothing", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 7 }));

    await m.focus();

    expect(m.fetchSpy).toHaveBeenCalled();
    expect(plain(document.body.textContent)).not.toContain(AVAILABLE);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("TP-11.11: a rejected fetch shows nothing and reports no error", async () => {
    const consoleError = vi.spyOn(console, "error");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const m = await mount(() => Promise.reject(new TypeError("Failed to fetch")));

      await m.focus();

      expect(m.fetchSpy).toHaveBeenCalled();
      expect(plain(document.body.textContent)).not.toContain(AVAILABLE);
      expect(consoleError).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("TP-11.11: two focus events 30 s apart fetch once", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 7 }));

    await m.focus();
    const afterFirst = m.fetchSpy.mock.calls.length;
    m.advance(30_000);
    await m.focus();

    expect(afterFirst).toBeGreaterThan(0);
    expect(m.fetchSpy).toHaveBeenCalledTimes(afterFirst);
  });

  it("TP-11.11: a focus 61 s after a check fetches again", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 7 }));

    await m.focus();
    const afterFirst = m.fetchSpy.mock.calls.length;
    m.advance(61_000);
    await m.focus();

    expect(m.fetchSpy).toHaveBeenCalledTimes(afterFirst + 1);
  });

  it("TP-11.11: buildNumber 7 and /version.json 8 on focus: the toast with a Reload button", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 8 }));

    await m.focus();

    await waitFor(() => {
      expect(plain(document.body.textContent)).toContain(AVAILABLE);
    });
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("TP-11.11 (A-404): the new-build toast's only control is Reload (no close button), and it stays past the 6 s of a normal toast", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 8 }));

    await m.focus();
    /** The innermost elements holding the toast's text, outside F-218's live regions. */
    const texts = () =>
      [...document.querySelectorAll<HTMLElement>("body *")].filter(
        (el) =>
          plain(el.textContent) === AVAILABLE &&
          el.closest("#live-polite, #live-assertive") === null &&
          ![...el.children].some((c) => plain(c.textContent) === AVAILABLE),
      );
    await waitFor(() => {
      expect(texts().length).toBeGreaterThan(0);
    });
    for (const text of texts()) {
      const toast = text.closest("li") ?? text;
      const controls = within(toast).queryAllByRole("button");
      expect(controls.map((b) => plain(b.textContent))).toEqual(["Reload"]);
    }
    const shownBefore = texts();

    await new Promise((r) => setTimeout(r, 6_500));
    for (const text of shownBefore) expect(text.isConnected).toBe(true);
  }, 15_000);

  it("TP-11.11: a check is scheduled every 30 minutes, and a scheduled check that finds 8 shows the toast", async () => {
    const m = await mount(() => Promise.resolve({ buildNumber: 8 }));

    const every30 = m.scheduled.filter((s) => s.ms === 30 * 60_000);
    expect(every30.length).toBeGreaterThan(0);
    const before = m.fetchSpy.mock.calls.length;
    // Toasts live in a module-level store, so one from an earlier case may still be listed.
    const reloads = screen.queryAllByRole("button", { name: "Reload" }).length;
    every30[0]?.fn();

    await waitFor(() => {
      expect(screen.queryAllByRole("button", { name: "Reload" })).toHaveLength(reloads + 1);
    });
    expect(m.fetchSpy).toHaveBeenCalledTimes(before + 1);
  });
});

// A-325 (a): an injected updateRequired accessor. (b), the global signal, is in
// updateRequiredGlobal.test.tsx, a fresh file, because markClientUpdateRequired is one-way.
describe("TP-11.12: update required banner (F-210, A-325)", () => {
  it('TP-11.12 (a): with updateRequired a signal set to true, a persistent role="alert" banner with Reload', async () => {
    const { UpdateNotifier } = await loadUpdateNotifier();
    const [required, setRequired] = createSignal(false);
    renderWithI18n(() => (
      <UpdateNotifier
        buildNumber={7}
        fetchVersion={() => Promise.resolve({ buildNumber: 7 })}
        schedule={() => () => undefined}
        updateRequired={required}
      />
    ));
    expect(screen.queryByRole("alert")).toBeNull();

    setRequired(true);

    const banner = await screen.findByRole("alert");
    expect(plain(banner.textContent)).toContain(
      "This version of Budmon is out of date. Reload to continue.",
    );
    expect(within(banner).getByRole("button", { name: "Reload" })).toBeTruthy();
    // Persistent: still there a long time later.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("alert")).toBe(banner);
  });
});
