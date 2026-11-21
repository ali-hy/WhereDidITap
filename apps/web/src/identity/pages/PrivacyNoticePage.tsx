// F-173: the privacy notice (§8.3). Public; no API calls.
import { Temporal } from "@budmon/shared";
import { createEffect, For, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { SignedOutColumn } from "../../ui/SignedOutColumn.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { identityMessages as m } from "../messages.js";

/** Bump whenever the notice's text changes. */
export const PRIVACY_NOTICE_DATE = "2026-11-15";

const SECTIONS = [
  { title: m.privacyCollectedTitle, body: m.privacyCollectedBody },
  { title: m.privacyGoogleTitle, body: m.privacyGoogleBody },
  { title: m.privacyEmailsTitle, body: m.privacyEmailsBody },
  { title: m.privacyExportTitle, body: m.privacyExportBody },
  { title: m.privacyDeletionTitle, body: m.privacyDeletionBody },
  { title: m.privacyBansTitle, body: m.privacyBansBody },
  { title: m.privacyAdminTitle, body: m.privacyAdminBody },
  { title: m.privacyContactTitle, body: m.privacyContactBody },
];

export function PrivacyNoticePage(): JSX.Element {
  const { t, formatDate } = useI18n();
  const date = () => formatDate(Temporal.PlainDate.from(PRIVACY_NOTICE_DATE));
  createEffect(() => {
    setDocumentTitle(t(m.privacyIntroTitle), t);
  });
  return (
    <SignedOutColumn>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(m.privacyIntroTitle)}
      </h1>
      <p class="mt-3 text-fg">{t(m.privacyIntroBody, { date: date() })}</p>
      <For each={SECTIONS}>
        {(s) => (
          <>
            <h2 class="mt-6 text-lg font-semibold text-fg">{t(s.title)}</h2>
            <p class="mt-2 text-fg">{t(s.body)}</p>
          </>
        )}
      </For>
    </SignedOutColumn>
  );
}
