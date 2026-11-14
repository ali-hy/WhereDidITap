// P-A-515 (b): a radio group on Kobalte's RadioGroup (UX guide §8.5), named by its label.
import { RadioGroup } from "@kobalte/core/radio-group";
import { For, Show, type JSX } from "solid-js";
import { describedBy, type FieldProps } from "./FieldShell.js";
import { FieldError } from "./forms.js";

export interface RadioOption {
  value: string;
  label: string;
}

export interface RadioGroupFieldProps extends FieldProps {
  options: readonly RadioOption[];
  value: string;
  onChange: (v: string) => void;
}

export function RadioGroupField(props: RadioGroupFieldProps): JSX.Element {
  return (
    <RadioGroup
      id={props.id}
      value={props.value}
      onChange={props.onChange}
      validationState={props.error === undefined ? "valid" : "invalid"}
      aria-describedby={describedBy(props)}
      class="flex flex-col"
    >
      <RadioGroup.Label class="mb-2 text-sm font-medium text-fg">{props.label}</RadioGroup.Label>
      <div class="flex flex-col">
        <For each={props.options}>
          {(option) => (
            <RadioGroup.Item value={option.value} class="flex min-h-11 items-center gap-3">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface data-[checked]:border-accent data-[checked]:bg-accent">
                <RadioGroup.ItemIndicator class="size-2 rounded-full bg-on-accent" />
              </RadioGroup.ItemControl>
              <RadioGroup.ItemLabel class="text-base text-fg">{option.label}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          )}
        </For>
      </div>
      <Show when={props.hint}>
        {(hint) => (
          <p id={`${props.id}-hint`} class="mt-1 text-sm text-fg-muted">
            {hint()}
          </p>
        )}
      </Show>
      <FieldError id={`${props.id}-error`} message={props.error} />
    </RadioGroup>
  );
}
