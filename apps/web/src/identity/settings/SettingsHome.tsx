// F-162: the settings landing page, drawn from the session's own `me`.
import { createEffect, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { identityMessages as m } from "../messages.js";
import { useSession } from "../session/SessionProvider.js";

export function SettingsHome(): JSX.Element {
  const { t } = useI18n();
  const session = useSession();
  createEffect(() => {
    setDocumentTitle(t(m.settingsTitle), t);
  });
  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(m.settingsTitle)}
      </h1>
      <p class="mt-3 text-fg [overflow-wrap:anywhere]">{session.me()?.displayName ?? ""}</p>
      <p class="text-fg-muted [overflow-wrap:anywhere]">
        <bdi dir="ltr">{session.me()?.email ?? ""}</bdi>
      </p>
    </>
  );
}
