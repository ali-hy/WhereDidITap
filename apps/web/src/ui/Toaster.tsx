// F-212: toasts through Kobalte's Toast region; non-persistent ones close after 6 s, paused on
// hover or focus. Errors are announced assertively, the rest politely. At most 3 are visible; the
// rest wait in order (A-463).
import { Toast, toaster } from "@kobalte/core/toast";
import { onCleanup, Show, type JSX } from "solid-js";
import { announce } from "./a11y.js";
import { Icon } from "./icons/Icon.js";

const DURATION_MS = 6000;
const VISIBLE_LIMIT = 3;

/** A-462: the non-colour cue and the inline-start border, by tone. */
const TONES = {
  info: { icon: "info", border: "border-sky-700" },
  success: { icon: "check", border: "border-green-700" },
  error: { icon: "alert", border: "border-red-700" },
} as const;

/** A-463: visible or queued toasts by tone and message, so an identical one isn't added twice. */
const active = new Map<string, number>();
const keyOf = (t: { tone: string; message: string }) => `${t.tone}\n${t.message}`;
function forget(id: number): void {
  for (const [key, value] of active) if (value === id) active.delete(key);
}

export interface ToastOptions {
  message: string;
  tone: "info" | "error" | "success";
  action?: { label: string; onClick: () => void };
  persistent?: boolean;
}

/**
 * A non-persistent toast's 6 s, from its first render (A-463: a queued toast can't expire unseen),
 * paused while the pointer is over it or it holds focus. Kobalte
 * pauses only for pointer events on its region, so each toast keeps its own timer (Kobalte sees
 * every toast as persistent). Capture-phase listeners also see the non-bubbling enter and leave
 * events of the toast's children.
 */
function autoDismiss(id: number): {
  attach: (el: HTMLElement) => void;
} {
  let remaining = DURATION_MS;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resume = () => {
    if (timer !== undefined) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      forget(id);
      toaster.dismiss(id);
    }, remaining);
  };
  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  // B-4: hover and focus pause independently; the timer runs only when neither holds.
  let hovered = false;
  let focused = false;
  const update = () => {
    if (hovered || focused) pause();
    else resume();
  };
  let started = false;
  return {
    attach(el) {
      if (started) return;
      started = true;
      resume();
      const leaves = (event: Event) => {
        const next = (event as MouseEvent | FocusEvent).relatedTarget;
        return !(next instanceof Node && el.contains(next));
      };
      for (const type of ["pointerenter", "pointermove", "mouseenter"]) {
        el.addEventListener(
          type,
          () => {
            hovered = true;
            update();
          },
          { capture: true },
        );
      }
      for (const type of ["pointerleave", "mouseleave"]) {
        el.addEventListener(
          type,
          (event) => {
            if (!leaves(event)) return;
            hovered = false;
            update();
          },
          { capture: true },
        );
      }
      el.addEventListener(
        "focusin",
        () => {
          focused = true;
          update();
        },
        { capture: true },
      );
      el.addEventListener(
        "focusout",
        (event) => {
          if (!leaves(event)) return;
          focused = false;
          update();
        },
        { capture: true },
      );
    },
  };
}

export function showToast(t: ToastOptions): string {
  const existing = active.get(keyOf(t));
  if (existing !== undefined) return String(existing);
  let attach: ((el: HTMLElement) => void) | undefined;
  let rendered: HTMLElement | undefined;
  const tone = TONES[t.tone];
  const id = toaster.show((props) => {
    onCleanup(() => {
      forget(props.toastId);
    });
    return (
      <Toast
        ref={(el: HTMLElement) => {
          rendered = el;
          attach?.(el);
        }}
        toastId={props.toastId}
        priority={t.tone === "error" ? "high" : "low"}
        persistent
        aria-live="off"
        data-tone={t.tone}
        class={`flex [max-inline-size:min(24rem,calc(100vw-2rem))] items-center gap-3 rounded border-s-4 bg-white p-3 text-gray-900 shadow ${tone.border}`}
      >
        <Icon name={tone.icon} class="shrink-0" />
        <Toast.Description>{t.message}</Toast.Description>
        <Show when={t.action}>
          {(action) => (
            <button
              type="button"
              onClick={() => {
                action().onClick();
              }}
            >
              {action().label}
            </button>
          )}
        </Show>
      </Toast>
    );
  });
  active.set(keyOf(t), id);
  // A-400: announced through F-218's permanent regions, not Kobalte's per-toast live region.
  announce(t.message, t.tone === "error" ? "assertive" : "polite");
  if (t.persistent !== true) {
    attach = autoDismiss(id).attach;
    // The toast may already have rendered inside show().
    if (rendered !== undefined) attach(rendered);
  }
  return String(id);
}

export function dismissToast(id: string): void {
  const n = Number.parseInt(id, 10);
  forget(n);
  toaster.dismiss(n);
}

export function Toaster(): JSX.Element {
  return (
    <Toast.Region aria-live="off" limit={VISIBLE_LIMIT}>
      <Toast.List class="fixed bottom-4 end-4 flex flex-col gap-2" />
    </Toast.Region>
  );
}
