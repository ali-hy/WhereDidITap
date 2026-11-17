// P-A-515 (c), A-523: the product name as the header's wordmark (UX guide §2.1): "wDit" in Plex Sans
// 600 at 20 px, the "D" in the accent colour. One accessible name (the visible text), always left
// to right.
import { Show, type JSX } from "solid-js";
import { APP_NAME } from "../app/brand.js";

export interface WordmarkProps {
  /** Makes the wordmark a link (signed-in screens link home). */
  href?: string;
  /** Click handler of the link. */
  onClick?: (event: MouseEvent) => void;
}

// The parts join to APP_NAME; anything else renders the plain name.
const PARTS = ["w", "D", "it"] as const;
const CLASSES = "text-[1.25rem] font-semibold text-fg no-underline";

function Name(): JSX.Element {
  return PARTS.join("") === APP_NAME ? (
    <>
      {PARTS[0]}
      <span class="text-accent-fg">{PARTS[1]}</span>
      {PARTS[2]}
    </>
  ) : (
    <>{APP_NAME}</>
  );
}

export function Wordmark(props: WordmarkProps): JSX.Element {
  return (
    <Show
      when={props.href}
      fallback={
        <span dir="ltr" class={CLASSES}>
          <Name />
        </span>
      }
    >
      {(href) => (
        <a href={href()} dir="ltr" class={CLASSES} onClick={(e) => props.onClick?.(e)}>
          <Name />
        </a>
      )}
    </Show>
  );
}
