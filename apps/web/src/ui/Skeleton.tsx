// P-A-515 (c): loading blocks in `surface-sunken` (UX guide §9.1), shown only after 300 ms so fast
// loads don't flash. The caller marks its region `aria-busy`.
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";

export interface SkeletonProps {
  rows?: number;
  shape?: "text" | "row";
}

const SHOW_AFTER_MS = 300;

export function Skeleton(props: SkeletonProps): JSX.Element {
  const [visible, setVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
  });
  onCleanup(() => {
    clearTimeout(timer);
  });
  const rows = () => Array.from({ length: props.rows ?? 1 }, (_, i) => i);
  return (
    <Show when={visible()}>
      <div aria-hidden="true" class="flex flex-col gap-3">
        <For each={rows()}>
          {() => (
            <div
              class={`animate-pulse [animation-duration:1.5s] rounded-control bg-surface-sunken motion-reduce:animate-none ${
                props.shape === "row" ? "h-11" : "h-4"
              }`}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
