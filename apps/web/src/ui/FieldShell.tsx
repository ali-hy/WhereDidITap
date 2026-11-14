// P-A-515 (b): what the text-like fields share: label, control, hint, error and their ids.
import { Show, type JSX } from "solid-js";
import { FieldError } from "./forms.js";

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

/** `<id>-hint` then `<id>-error`, each only when shown. */
export function describedBy(p: Pick<FieldProps, "id" | "hint" | "error">): string | undefined {
  const ids = [
    p.hint === undefined ? "" : `${p.id}-hint`,
    p.error === undefined ? "" : `${p.id}-error`,
  ].filter((i) => i !== "");
  return ids.length === 0 ? undefined : ids.join(" ");
}

/** Input classes: a 1 px `line-strong` border, 2 px `danger` with an error. */
export function inputClasses(hasError: boolean): string {
  return [
    "block min-h-11 rounded-control bg-surface px-3 text-base text-fg placeholder:text-fg-muted",
    hasError ? "border-2 border-danger" : "border border-line-strong hover:border-fg-muted",
  ].join(" ");
}

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: JSX.Element;
}

export function FieldShell(props: FieldShellProps): JSX.Element {
  return (
    <div class="flex flex-col">
      <label for={props.id} class="mb-2 text-sm font-medium text-fg">
        {props.label}
      </label>
      {props.children}
      <Show when={props.hint}>
        {(hint) => (
          <p id={`${props.id}-hint`} class="mt-1 text-sm text-fg-muted">
            {hint()}
          </p>
        )}
      </Show>
      <FieldError id={`${props.id}-error`} message={props.error} />
    </div>
  );
}
