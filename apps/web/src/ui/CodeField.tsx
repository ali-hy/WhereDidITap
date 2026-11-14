// P-A-515 (b): one input for a verification or recovery code (UX guide §8.3).
import type { JSX } from "solid-js";
import { describedBy, FieldShell, inputClasses, type FieldProps } from "./FieldShell.js";

export interface CodeFieldProps extends FieldProps {
  value: string;
  onInput: (v: string) => void;
  onBlur?: () => void;
  /** `numeric` (the default) is a one-time code; `text` is a recovery code. */
  kind?: "numeric" | "text";
}

export function CodeField(props: CodeFieldProps): JSX.Element {
  const numeric = () => props.kind !== "text";
  return (
    <FieldShell id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <input
        id={props.id}
        type="text"
        dir="ltr"
        class={`${inputClasses(props.error !== undefined)} w-[12em] font-mono text-xl tracking-widest`}
        value={props.value}
        inputmode={numeric() ? "numeric" : "text"}
        autocomplete={numeric() ? "one-time-code" : "off"}
        autocapitalize={numeric() ? undefined : "characters"}
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
