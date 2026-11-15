// F-155 (S-1): the sign-in page's shell. The form arrives with S-3.
import { useSearch } from "@tanstack/solid-router";
import { createEffect, Show, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { SignedOutColumn } from "../../ui/SignedOutColumn.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { identityMessages } from "../messages.js";

export function SignInPage(): JSX.Element {
  const { t } = useI18n();
  const search: () => { reason?: unknown } = useSearch({ strict: false });
  createEffect(() => {
    setDocumentTitle(t(identityMessages.signinTitle), t);
  });
  return (
    <SignedOutColumn>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(identityMessages.signinTitle)}
      </h1>
      <Show when={search().reason === "ended"}>
        <p role="status" class="mt-3 text-fg">
          {t(identityMessages.signinSessionEnded)}
        </p>
      </Show>
      <p class="mt-3 text-fg-muted">{t(identityMessages.signinInviteOnly)}</p>
      <p class="mt-3">
        <a href="/privacy">{t(identityMessages.signinPrivacy)}</a>
      </p>
    </SignedOutColumn>
  );
}
