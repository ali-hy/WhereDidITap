// P-A-515 (a): the shared button (UX guide §7). Callers pass the translated label.
import { Show, splitProps, type JSX } from "solid-js";
import { Icon } from "./icons/Icon.js";
import type { IconName } from "./icons/registry.js";

export interface ButtonProps {
  variant: "primary" | "secondary" | "tertiary" | "destructive";
  /** The label. */
  children: JSX.Element;
  size?: "default" | "compact";
  type?: "button" | "submit";
  /** Shown at the inline start. */
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Renders an `<a>` with the button's classes. */
  href?: string;
  onClick?: (e: MouseEvent) => void;
  "aria-describedby"?: string;
  /** The rendered button, for callers that move focus to it. */
  ref?: (el: HTMLButtonElement) => void;
  /** Marks the error page's Try again for focus handling (A-456). */
  "data-fallback-retry"?: boolean;
}

const VARIANT: Readonly<Record<ButtonProps["variant"], string>> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-surface text-fg border border-line-strong hover:bg-surface-sunken",
  tertiary: "text-accent-fg hover:underline",
  destructive: "bg-danger text-on-danger",
};

/** The same classes for a button and a link. */
export function buttonClasses(props: Pick<ButtonProps, "variant" | "size" | "fullWidth">): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-control px-4 text-base font-semibold no-underline",
    props.size === "compact" ? "min-h-9 min-w-11" : "min-h-11",
    VARIANT[props.variant],
    "disabled:bg-surface-sunken disabled:text-fg-muted",
    props.fullWidth === true ? "w-full" : "",
  ]
    .filter((c) => c !== "")
    .join(" ");
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "variant",
    "children",
    "size",
    "type",
    "icon",
    "busy",
    "disabled",
    "fullWidth",
    "href",
    "onClick",
  ]);
  const classes = () => buttonClasses(local);
  // Busy keeps the label and focus: it swaps the icon for a spinner and ignores activation.
  const content = () => (
    <>
      <Show
        when={local.busy === true}
        fallback={
          <Show when={local.icon}>{(name) => <Icon name={name()} class="size-5 shrink-0" />}</Show>
        }
      >
        <Icon name="refresh" class="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
      </Show>
      {local.children}
    </>
  );
  return (
    <Show
      when={local.href}
      fallback={
        <button
          ref={rest.ref}
          data-fallback-retry={rest["data-fallback-retry"] === true ? "" : undefined}
          type={local.type ?? "button"}
          class={classes()}
          disabled={local.disabled === true}
          aria-busy={local.busy === true ? "true" : undefined}
          aria-describedby={rest["aria-describedby"]}
          onClick={(e) => {
            if (local.busy === true) {
              e.preventDefault();
              return;
            }
            local.onClick?.(e);
          }}
        >
          {content()}
        </button>
      }
    >
      {(href) => (
        <a
          href={href()}
          class={classes()}
          aria-describedby={rest["aria-describedby"]}
          onClick={(e) => local.onClick?.(e)}
        >
          {content()}
        </a>
      )}
    </Show>
  );
}
