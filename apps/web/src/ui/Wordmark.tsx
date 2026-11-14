// P-A-515 (c): the product name as the header's wordmark. Plain `APP_NAME` text in `fg` for now
// (identity A-26): one accessible name, always left to right.
import { Show, type JSX } from "solid-js";
import { APP_NAME } from "../app/brand.js";

export interface WordmarkProps {
  /** Makes the wordmark a link (signed-in screens link home). */
  href?: string;
}

const CLASSES = "text-lg font-semibold text-fg no-underline";

export function Wordmark(props: WordmarkProps): JSX.Element {
  return (
    <Show
      when={props.href}
      fallback={
        <span dir="ltr" class={CLASSES}>
          {APP_NAME}
        </span>
      }
    >
      {(href) => (
        <a href={href()} dir="ltr" class={CLASSES}>
          {APP_NAME}
        </a>
      )}
    </Show>
  );
}
