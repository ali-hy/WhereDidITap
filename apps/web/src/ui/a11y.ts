// F-218: screen-reader announcements through the visually hidden live regions, and page titles.
import { APP_NAME } from "../app/brand.js";
import { messages } from "../i18n/messages.js";
import type { MessageDescriptor } from "../i18n/useI18n.js";

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

/** `useI18n().t`'s type. */
export type Translate = (d: MessageDescriptor, v?: Record<string, unknown>) => string;

/**
 * A-464: the tab title for a page: APP_NAME for null, otherwise app.documentTitle with the page's
 * translated <h1> text, without bidi isolates (tab titles render them inconsistently).
 */
export function setDocumentTitle(page: string | null, t: Translate): void {
  document.title =
    page === null
      ? APP_NAME
      : t(messages.appDocumentTitle, { page }).replace(/[\u2066-\u2069]/g, "");
}
