// F-216: the home page until identity replaces it.
import { createEffect, type JSX } from "solid-js";
import { setDocumentTitle } from "../ui/a11y.js";
import { APP_NAME } from "../app/brand.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

export function HomePlaceholder(): JSX.Element {
  const { t } = useI18n();
  createEffect(() => {
    setDocumentTitle(null, t);
  });
  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {APP_NAME}
      </h1>
      <p class="mt-3 text-fg">{t(messages.homePlaceholder)}</p>
    </>
  );
}
