// F-210: the new-build toast and the update-required banner (J-6). Never reloads by itself.
import { onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { clientUpdateRequired } from "../api/clientUpdate.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { showToast } from "./Toaster.js";

const FOCUS_MIN_INTERVAL_MS = 60_000;
const CHECK_EVERY_MS = 30 * 60_000;

async function fetchVersionJson(): Promise<{ buildNumber: number }> {
  const res = await fetch("/version.json", { cache: "no-store" });
  return (await res.json()) as { buildNumber: number };
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms);
  return () => {
    clearInterval(id);
  };
}

export function UpdateNotifier(props: {
  buildNumber: number;
  fetchVersion?: () => Promise<{ buildNumber: number }>;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** A-325: defaults to the global clientUpdateRequired. */
  updateRequired?: Accessor<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const now = () => (props.now ?? Date.now)();
  let lastCheck: number | undefined;
  let toastShown = false;

  const check = async (): Promise<void> => {
    lastCheck = now();
    try {
      const { buildNumber } = await (props.fetchVersion ?? fetchVersionJson)();
      if (buildNumber > props.buildNumber && !toastShown) {
        toastShown = true;
        showToast({
          message: t(messages.updateWebAvailable),
          tone: "info",
          persistent: true,
          action: {
            label: t(messages.updateWebReload),
            onClick: () => {
              location.reload();
            },
          },
        });
      }
    } catch {
      // Failures are ignored silently; the next focus or schedule tries again.
    }
  };

  const onFocus = () => {
    if (lastCheck !== undefined && now() - lastCheck < FOCUS_MIN_INTERVAL_MS) return;
    void check();
  };

  onMount(() => {
    window.addEventListener("focus", onFocus);
    const cancel = (props.schedule ?? defaultSchedule)(() => void check(), CHECK_EVERY_MS);
    onCleanup(() => {
      window.removeEventListener("focus", onFocus);
      cancel();
    });
  });

  const required = () => (props.updateRequired ?? clientUpdateRequired)();

  return (
    <Show when={required()}>
      <div role="alert" class="flex items-center gap-4 p-3">
        <p>{t(messages.updateRequiredWeb)}</p>
        <button
          type="button"
          onClick={() => {
            location.reload();
          }}
        >
          {t(messages.updateWebReload)}
        </button>
      </div>
    </Show>
  );
}
