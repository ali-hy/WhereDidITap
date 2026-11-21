// F-209: the S-2 error fallback (§8.1): title, body, an optional reference, Try again and a link
// home (a plain link, so it works without a router).
import { createEffect, createSignal, createUniqueId, Show, type JSX } from "solid-js";
import type { AppError } from "../api/errors.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { setDocumentTitle } from "./a11y.js";
import { Button } from "./Button.js";

/** Marks where the reference goes inside the translated sentence (private use, never shown). */
const SLOT = "";

export function ErrorFallback(props: {
  error: AppError;
  requestId?: string;
  onRetry: () => Promise<void>;
  /** A-397: the root layout's retryFailed, which survives the fallback's remount. */
  stillFailing?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = createSignal(false);
  const [stillFailing, setStillFailing] = createSignal(false);
  const statusId = createUniqueId();
  let button: HTMLElement | undefined;

  // A-464: the tab title follows the <h1>.
  createEffect(() => {
    setDocumentTitle(t(messages.errorFallbackTitle), t);
  });

  const retry = async (): Promise<void> => {
    setBusy(true);
    setStillFailing(false);
    try {
      await props.onRetry();
    } catch {
      setStillFailing(true);
      // A-456: back on Try again (enabled first), described by the status line.
      setBusy(false);
      if (button?.isConnected === true) button.focus();
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Reference: {ref}" around a <bdi dir="ltr"> holding the first 8 characters. The parts are read
   * in JSX, so they follow the catalog and setLocale like the other strings (Q-D1).
   */
  const referenceParts = (): string[] =>
    t(messages.errorReference, { ref: SLOT })
      .replace(/[\u2068\u2069]/g, "")
      .split(SLOT);
  const reference = (requestId: () => string) => (
    <p class="mt-2 font-mono text-sm text-fg-muted">
      {referenceParts()[0] ?? ""}
      <bdi dir="ltr">{requestId().slice(0, 8)}</bdi>
      {referenceParts()[1] ?? ""}
    </p>
  );

  return (
    <section>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(messages.errorFallbackTitle)}
      </h1>
      {/* A-457: "share this reference" only when there is one. */}
      <p class="mt-3 text-fg">
        {props.requestId === undefined || props.requestId === ""
          ? t(messages.errorFallbackBodyNoReference)
          : t(messages.errorFallbackBody)}
      </p>
      <Show when={props.requestId}>{(id) => reference(id)}</Show>
      <div class="mt-6 flex flex-wrap gap-3">
        <Button
          variant="primary"
          icon="refresh"
          busy={busy()}
          ref={(el) => {
            button = el;
          }}
          data-fallback-retry
          aria-describedby={statusId}
          onClick={() => void retry()}
        >
          {t(messages.errorFallbackRetry)}
        </Button>
        <Button variant="secondary" href="/">
          {t(messages.errorFallbackHome)}
        </Button>
      </div>
      {/* A-400: the status element is always rendered and filled when the retry failed. */}
      <p id={statusId} role="status" class="mt-4 text-fg">
        {stillFailing() || props.stillFailing === true ? t(messages.errorFallbackStillFailing) : ""}
      </p>
    </section>
  );
}
