// F-209: the S-2 error fallback (§8.1): title, body, an optional reference, Try again and a link
// home (a plain link, so it works without a router).
import { createEffect, createSignal, createUniqueId, Show, type JSX } from "solid-js";
import type { AppError } from "../api/errors.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { setDocumentTitle } from "./a11y.js";
import { Icon } from "./icons/Icon.js";

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
  let button: HTMLButtonElement | undefined;

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
    <p>
      {referenceParts()[0] ?? ""}
      <bdi dir="ltr">{requestId().slice(0, 8)}</bdi>
      {referenceParts()[1] ?? ""}
    </p>
  );

  return (
    <section class="mx-auto max-w-[40rem] p-4">
      <h1 tabindex="-1" class="text-xl font-semibold">
        {t(messages.errorFallbackTitle)}
      </h1>
      {/* A-457: "share this reference" only when there is one. */}
      <p>
        {props.requestId === undefined || props.requestId === ""
          ? t(messages.errorFallbackBodyNoReference)
          : t(messages.errorFallbackBody)}
      </p>
      <Show when={props.requestId}>{(id) => reference(id)}</Show>
      <div class="mt-4 flex gap-4">
        <button
          ref={button}
          type="button"
          data-fallback-retry
          aria-describedby={statusId}
          aria-busy={busy() ? "true" : undefined}
          disabled={busy()}
          onClick={() => void retry()}
        >
          {/* B-6: a decorative spinner while the retry runs (§8.1 S-2). */}
          <Show when={busy()}>
            <Icon name="refresh" class="me-2 inline animate-spin" />
          </Show>
          {t(messages.errorFallbackRetry)}
        </button>
        <a href="/">{t(messages.errorFallbackHome)}</a>
      </div>
      {/* A-400: the status element is always rendered and filled when the retry failed. */}
      <p id={statusId} role="status">
        {stillFailing() || props.stillFailing === true ? t(messages.errorFallbackStillFailing) : ""}
      </p>
    </section>
  );
}
