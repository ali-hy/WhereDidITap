// The theme setting, its device cache and the resolved mode (UX guide §3.5).
// The cache is `localStorage["budmon.theme"]`; `public/theme-boot.js` reads it before first paint.

export type ThemeSetting = "system" | "light" | "dark";

const KEY = "budmon.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

let current: ThemeSetting = "system";
let listening = false;

const isSetting = (v: unknown): v is ThemeSetting =>
  v === "system" || v === "light" || v === "dark";

/** The cached setting; absent, unreadable or unknown reads as `system`. */
export function themeSetting(): ThemeSetting {
  try {
    const cached = localStorage.getItem(KEY);
    return isSetting(cached) ? cached : "system";
  } catch {
    return "system";
  }
}

const systemIsDark = (): boolean => window.matchMedia(DARK_QUERY).matches;

function apply(setting: ThemeSetting): void {
  current = setting;
  const dark = setting === "system" ? systemIsDark() : setting === "dark";
  document.documentElement.setAttribute("data-mode", dark ? "dark" : "light");
}

/** The mode follows the system only while the setting is `system`. */
function listen(): void {
  if (listening) return;
  listening = true;
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (current === "system") apply("system");
  });
}

/** Writes the device cache (errors swallowed), applies the mode and follows the system if asked. */
export function setThemeSetting(setting: ThemeSetting): void {
  try {
    localStorage.setItem(KEY, setting);
  } catch {
    // Blocked storage: the mode still applies for this page.
  }
  listen();
  apply(setting);
}

/** Called once at start: follows system changes while the cached setting is `system`. */
export function initTheme(): void {
  current = themeSetting();
  listen();
}
