// Rendering helpers for S-11b component tests (test-architect).
import { render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { I18nProvider } from "../../src/i18n/I18nProvider.js";
import { useI18n, type I18n } from "../../src/i18n/useI18n.js";

/** Renders `ui` inside an English I18nProvider; returns the testing-library result and `t`. */
export function renderWithI18n(ui: () => JSX.Element): ReturnType<typeof render> & { i18n: I18n } {
  let captured: I18n | undefined;
  function Capture() {
    captured = useI18n();
    return null;
  }
  const result = render(() => (
    <I18nProvider initialLocale="en">
      <Capture />
      {ui()}
    </I18nProvider>
  ));
  if (captured === undefined) throw new Error("the provider rendered no context");
  return Object.assign(result, { i18n: captured });
}
