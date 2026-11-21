// P-A-513 (3) ui/theme.ts: the theme setting, its device cache and the resolved mode (guide §3.5).
// TP-0b.3, plus extra cases TP-0b.3x. IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs.
//
// Shapes per P-A-513 (3): ThemeSetting = "system" | "light" | "dark"; themeSetting() reads the cache
// (localStorage "budmon.theme", default "system"); setThemeSetting(s) writes it (storage errors
// swallowed), sets <html data-mode>, and follows prefers-color-scheme only while "system";
// initTheme() attaches that listener for the cached value.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ThemeModule = typeof import("../../src/ui/theme.js");

const KEY = "budmon.theme";
const QUERY = "(prefers-color-scheme: dark)";

/** A matchMedia stub for the dark-scheme query whose answer the test flips. */
function systemScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    get matches() {
      return dark;
    },
    media: QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  const matchMedia = vi.fn((query: string) => {
    if (query !== QUERY) throw new Error(`unexpected media query ${query}`);
    return mql as unknown as MediaQueryList;
  });
  return {
    matchMedia,
    flip(toDark: boolean) {
      dark = toDark;
      for (const cb of [...listeners]) cb({ matches: toDark, media: QUERY } as MediaQueryListEvent);
    },
  };
}

let scheme: ReturnType<typeof systemScheme>;

/** A fresh copy of the module, so no listener or state carries over between tests. */
async function load(initialDark: boolean): Promise<ThemeModule> {
  scheme = systemScheme(initialDark);
  vi.stubGlobal("matchMedia", scheme.matchMedia);
  vi.resetModules();
  return import("../../src/ui/theme.js");
}

const mode = () => document.documentElement.getAttribute("data-mode");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-mode");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("TP-0b.3: setThemeSetting, themeSetting and the system scheme", () => {
  it('TP-0b.3: setThemeSetting("dark") sets data-mode dark and caches "dark"', async () => {
    const theme = await load(false);

    theme.setThemeSetting("dark");

    expect(mode()).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(theme.themeSetting()).toBe("dark");
  });

  it('TP-0b.3: setThemeSetting("light") with the system dark sets data-mode light and caches "light"', async () => {
    const theme = await load(true);

    theme.setThemeSetting("light");

    expect(mode()).toBe("light");
    expect(localStorage.getItem(KEY)).toBe("light");
  });

  it('TP-0b.3: setThemeSetting("system") follows the system: dark, then light live after it flips', async () => {
    const theme = await load(true);

    theme.setThemeSetting("system");

    expect(mode()).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("system");

    scheme.flip(false);
    expect(mode()).toBe("light");

    scheme.flip(true);
    expect(mode()).toBe("dark");
  });

  it("TP-0b.3: an explicit setting stops following the system", async () => {
    const theme = await load(true);
    theme.setThemeSetting("system");

    theme.setThemeSetting("light");
    scheme.flip(true);
    scheme.flip(false);
    scheme.flip(true);

    expect(mode()).toBe("light");
  });

  it("TP-0b.3: with localStorage throwing, the mode still applies and nothing throws", async () => {
    const theme = await load(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => {
      theme.setThemeSetting("dark");
    }).not.toThrow();
    expect(mode()).toBe("dark");
    expect(theme.themeSetting()).toBe("system");
  });

  it('TP-0b.3: a cached "purple" reads as system', async () => {
    localStorage.setItem(KEY, "purple");
    const theme = await load(false);

    expect(theme.themeSetting()).toBe("system");
  });
});

describe("TP-0b.3x: the cache and initTheme", () => {
  it("TP-0b.3x: with nothing cached, themeSetting() is system", async () => {
    const theme = await load(false);

    expect(theme.themeSetting()).toBe("system");
  });

  it.each(["light", "dark", "system"] as const)(
    "TP-0b.3x: a cached %j reads back as itself",
    async (value) => {
      localStorage.setItem(KEY, value);
      const theme = await load(false);

      expect(theme.themeSetting()).toBe(value);
    },
  );

  it("TP-0b.3x: initTheme with the cache system follows a later system change", async () => {
    localStorage.setItem(KEY, "system");
    const theme = await load(false);
    document.documentElement.setAttribute("data-mode", "light");

    theme.initTheme();
    scheme.flip(true);

    expect(mode()).toBe("dark");
  });

  it("TP-0b.3x: initTheme with nothing cached follows a later system change", async () => {
    const theme = await load(true);
    document.documentElement.setAttribute("data-mode", "dark");

    theme.initTheme();
    scheme.flip(false);

    expect(mode()).toBe("light");
  });

  it("TP-0b.3x: initTheme with the cache dark ignores system changes", async () => {
    localStorage.setItem(KEY, "dark");
    const theme = await load(false);
    document.documentElement.setAttribute("data-mode", "dark");

    theme.initTheme();
    scheme.flip(false);
    scheme.flip(true);
    scheme.flip(false);

    expect(mode()).toBe("dark");
  });

  it("TP-0b.3x: setThemeSetting never writes anything but the three values to the cache", async () => {
    const theme = await load(false);

    for (const s of ["light", "dark", "system"] as const) {
      theme.setThemeSetting(s);
      expect(localStorage.getItem(KEY)).toBe(s);
    }
    expect(Object.keys(localStorage)).toEqual([KEY]);
  });
});
