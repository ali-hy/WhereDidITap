// F-211: the web offline banner (C-1).
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { Icon } from "./icons/Icon.js";

const BACK_ONLINE_MS = 3000;

export function OfflineBanner(): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = createSignal<"hidden" | "offline" | "back">(
    navigator.onLine ? "hidden" : "offline",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;

  const offline = () => {
    clearTimeout(timer);
    setState("offline");
  };
  const online = () => {
    if (state() !== "offline") return;
    // N-3: only a real back-online transition restarts the timer.
    clearTimeout(timer);
    setState("back");
    timer = setTimeout(() => setState("hidden"), BACK_ONLINE_MS);
  };

  onMount(() => {
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (!navigator.onLine) setState("offline");
  });
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
  });

  // A-373: the live region is always mounted (empty while online); only its content changes, so
  // screen readers announce it.
  return (
    <div role="status" aria-live="polite">
      <Show when={state() !== "hidden"}>
        <p class="flex items-center gap-2 p-2">
          <Icon name={state() === "offline" ? "offline" : "check"} />
          {state() === "offline" ? t(messages.offlineBannerWeb) : t(messages.offlineBack)}
        </p>
      </Show>
    </div>
  );
}
