// F-170 (S-1): the first-run home. Add account appears once `accounts` registers its route.
import { createEffect, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { EmptyState } from "../../ui/EmptyState.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { identityMessages } from "../messages.js";
import { useSession } from "../session/SessionProvider.js";

export function HomeFirstRun(): JSX.Element {
  const { t } = useI18n();
  const session = useSession();
  const title = () => t(identityMessages.homeWelcome, { name: session.me()?.displayName ?? "" });
  createEffect(() => {
    setDocumentTitle(title(), t);
  });
  return (
    <EmptyState
      icon="wallet"
      headingLevel={1}
      title={title()}
      body={t(identityMessages.homeFirstRun)}
    />
  );
}
