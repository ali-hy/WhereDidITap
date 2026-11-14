// A-464: fixtures set the tab title from their <h1> text, as pages do.
import { createEffect } from "solid-js";
import { useI18n } from "../i18n/useI18n.js";
import { setDocumentTitle } from "../ui/a11y.js";

export function useFixtureTitle(page: string): void {
  const { t } = useI18n();
  createEffect(() => {
    setDocumentTitle(page, t);
  });
}
