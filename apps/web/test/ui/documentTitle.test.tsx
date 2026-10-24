// F-218 setDocumentTitle (A-464): APP_NAME for null, otherwise "{page} – Budmon" without bidi
// isolates. TP-11.32.
import { describe, expect, it } from "vitest";
import { setDocumentTitle } from "../../src/ui/a11y.js";
import { renderWithI18n } from "../support/render.js";

describe("TP-11.32: setDocumentTitle (F-218, A-464)", () => {
  it("TP-11.32: null → Budmon", () => {
    const { i18n } = renderWithI18n(() => null);

    setDocumentTitle(null, i18n.t);

    expect(document.title).toBe("Budmon");
  });

  it("TP-11.32: Page not found → Page not found – Budmon, with no U+2066 to U+2069", () => {
    const { i18n } = renderWithI18n(() => null);

    setDocumentTitle("Page not found", i18n.t);

    expect(document.title).toBe("Page not found – Budmon");
    expect(document.title).not.toMatch(/[⁦-⁩]/);
  });
});
