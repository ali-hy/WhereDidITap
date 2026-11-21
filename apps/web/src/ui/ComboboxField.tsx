// P-A-515 (b): a searchable select on Kobalte's Combobox (UX guide §8.4). Options filter by a
// case-insensitive substring of their label.
import { Combobox } from "@kobalte/core/combobox";
import { Show, type JSX } from "solid-js";
import { describedBy, inputClasses, type FieldProps } from "./FieldShell.js";
import { FieldError } from "./forms.js";
import { Icon } from "./icons/Icon.js";

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
}

export interface ComboboxFieldProps extends FieldProps {
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (v: string | null) => void;
}

interface OptionGroup {
  label: string;
  options: ComboboxOption[];
}

const contains = (option: ComboboxOption, input: string): boolean =>
  option.label.toLowerCase().includes(input.trim().toLowerCase());

/** Options in the order given, gathered under their group's first appearance. */
function groupOf(options: readonly ComboboxOption[]): OptionGroup[] {
  const groups = new Map<string, ComboboxOption[]>();
  for (const o of options) {
    const key = o.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups].map(([label, list]) => ({ label, options: list }));
}

export function ComboboxField(props: ComboboxFieldProps): JSX.Element {
  const selected = () => props.options.find((o) => o.value === props.value) ?? null;
  const grouped = () => props.options.some((o) => o.group !== undefined);
  return (
    <Combobox<ComboboxOption, OptionGroup>
      options={grouped() ? groupOf(props.options) : (props.options as ComboboxOption[])}
      {...(grouped() ? { optionGroupChildren: "options" as const } : {})}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      defaultFilter={contains}
      value={selected()}
      onChange={(o) => {
        props.onChange(o === null ? null : o.value);
      }}
      itemComponent={(item) => (
        <Combobox.Item
          item={item.item}
          class="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-fg data-[highlighted]:bg-accent-tint data-[highlighted]:text-on-accent-tint"
        >
          <Combobox.ItemLabel>{item.item.rawValue.label}</Combobox.ItemLabel>
          <Combobox.ItemIndicator>
            <Icon name="check" class="size-5" />
          </Combobox.ItemIndicator>
        </Combobox.Item>
      )}
      sectionComponent={(section) => (
        <Show when={section.section.rawValue.label !== ""}>
          <span class="block px-3 pt-2 text-sm font-medium text-fg-muted">
            {section.section.rawValue.label}
          </span>
        </Show>
      )}
      validationState={props.error === undefined ? "valid" : "invalid"}
    >
      <Combobox.Label class="mb-2 block text-sm font-medium text-fg">{props.label}</Combobox.Label>
      <Combobox.Control class="relative">
        <Combobox.Input
          id={props.id}
          class={`${inputClasses(props.error !== undefined)} w-full pe-12`}
          aria-describedby={describedBy(props)}
          aria-invalid={props.error === undefined ? undefined : "true"}
        />
        <Combobox.Trigger
          aria-label={props.label}
          class="absolute inset-y-0 end-0 inline-flex min-w-11 items-center justify-center text-fg-muted"
        >
          <Combobox.Icon>
            <Icon name="chevron-down" class="size-5" />
          </Combobox.Icon>
        </Combobox.Trigger>
      </Combobox.Control>
      <Show when={props.hint}>
        {(hint) => (
          <p id={`${props.id}-hint`} class="mt-1 text-sm text-fg-muted">
            {hint()}
          </p>
        )}
      </Show>
      <FieldError id={`${props.id}-error`} message={props.error} />
      <Combobox.Portal>
        <Combobox.Content class="z-10 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-raised p-1 shadow-overlay">
          <Combobox.Listbox />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
