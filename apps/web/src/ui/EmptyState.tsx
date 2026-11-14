// P-A-515 (c): the page-level empty state (UX guide §9.2): an icon in an accent circle, a heading,
// one line and an optional action.
import { Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon } from "./icons/Icon.js";
import type { IconName } from "./icons/registry.js";

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body: string;
  action?: JSX.Element;
  /** 1 when the state is the page's only content; 2 otherwise (the default). */
  headingLevel?: 1 | 2;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class="flex flex-col items-center px-4 pt-12 text-center">
      <div
        aria-hidden="true"
        class="flex size-12 items-center justify-center rounded-full bg-accent-tint text-on-accent-tint"
      >
        <Icon name={props.icon} class="size-6" />
      </div>
      <Dynamic
        component={props.headingLevel === 1 ? "h1" : "h2"}
        tabindex={props.headingLevel === 1 ? "-1" : undefined}
        class="mt-3 text-xl font-semibold text-fg"
      >
        {props.title}
      </Dynamic>
      <p class="mt-1 text-fg-muted">{props.body}</p>
      <Show when={props.action}>{(action) => <div class="mt-4">{action()}</div>}</Show>
    </div>
  );
}
