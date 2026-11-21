// P-A-515 (b): a single-line text field with label, hint and error (UX guide §8.1).
import type { JSX } from "solid-js";
import { describedBy, FieldShell, inputClasses, type FieldProps } from "./FieldShell.js";

export interface TextFieldProps extends FieldProps {
  value: string;
  onInput: (v: string) => void;
  onBlur?: () => void;
  type?: "text" | "email";
  autocomplete?: string;
}

export function TextField(props: TextFieldProps): JSX.Element {
  return (
    <FieldShell id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <input
        id={props.id}
        type={props.type ?? "text"}
        dir={props.type === "email" ? "ltr" : undefined}
        class={`${inputClasses(props.error !== undefined)} w-full`}
        value={props.value}
        autocomplete={props.autocomplete}
        readOnly={props.readonly}
        aria-describedby={describedBy(props)}
        aria-invalid={props.error === undefined ? undefined : "true"}
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
        }}
        onBlur={() => props.onBlur?.()}
      />
    </FieldShell>
  );
}
