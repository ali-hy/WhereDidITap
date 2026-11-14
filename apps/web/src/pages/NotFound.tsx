// F-216: the not-found page.
import { Link } from "@tanstack/solid-router";
import { createEffect, type JSX } from "solid-js";
import { setDocumentTitle } from "../ui/a11y.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { buttonClasses } from "../ui/Button.js";

export function NotFound(): JSX.Element {
  const { t } = useI18n();
  createEffect(() => {
    setDocumentTitle(t(messages.errorNotFoundTitle), t);
  });
  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(messages.errorNotFoundTitle)}
      </h1>
      <p class="mt-6">
        <Link to="/" class={buttonClasses({ variant: "primary" })}>
          {t(messages.errorFallbackHome)}
        </Link>
      </p>
    </>
  );
}
