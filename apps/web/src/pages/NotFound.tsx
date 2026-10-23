// F-216: the not-found page.
import { Link } from "@tanstack/solid-router";
import { createEffect, type JSX } from "solid-js";
import { setDocumentTitle } from "../ui/a11y.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

export function NotFound(): JSX.Element {
  const { t } = useI18n();
  createEffect(() => {
    setDocumentTitle(t(messages.errorNotFoundTitle), t);
  });
  return (
    <>
      <h1 tabindex="-1" class="text-xl font-semibold">
        {t(messages.errorNotFoundTitle)}
      </h1>
      <p>
        <Link to="/">{t(messages.errorFallbackHome)}</Link>
      </p>
    </>
  );
}
