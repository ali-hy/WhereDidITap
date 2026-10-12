// F-218: screen-reader announcements through the visually hidden live regions.
const IDS = { polite: "live-polite", assertive: "live-assertive" } as const;

/** The live region, created (visually hidden) if the page doesn't have it yet. */
function region(politeness: "polite" | "assertive"): HTMLElement {
  const existing = document.getElementById(IDS[politeness]);
  if (existing !== null) return existing;
  const el = document.createElement("div");
  el.id = IDS[politeness];
  el.setAttribute("aria-live", politeness);
  el.setAttribute("aria-atomic", "true");
  el.className = "sr-only";
  document.body.append(el);
  return el;
}

/** Clears the region first, so the same text twice is announced twice. */
export function announce(text: string, politeness: "polite" | "assertive" = "polite"): void {
  const el = region(politeness);
  el.textContent = "";
  queueMicrotask(() => {
    el.textContent = text;
  });
}
