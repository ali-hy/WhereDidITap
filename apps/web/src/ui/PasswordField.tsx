// P-A-515 (b): a password field with a Show/Hide toggle inside it (UX guide §8.2).
import { createSignal, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { describedBy, FieldShell, inputClasses, type FieldProps } from "./FieldShell.js";
import { Icon } from "./icons/Icon.js";

export interface PasswordFieldProps extends FieldProps {
  value: string;
  onInput: (v: string) => void;
  onBlur?: () => void;
  autocomplete: "current-password" | "new-password";
}

export function PasswordField(props: PasswordFieldProps): JSX.Element {
  const { t } = useI18n();
  const [shown, setShown] = createSignal(false);
  return (
    <FieldShell id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <div class="relative">
        <input
          id={props.id}
          type={shown() ? "text" : "password"}
          class={`${inputClasses(props.error !== undefined)} w-full pe-24`}
          value={props.value}
          autocomplete={props.autocomplete}
          aria-describedby={describedBy(props)}
          aria-invalid={props.error === undefined ? undefined : "true"}
          onInput={(e) => {
            props.onInput(e.currentTarget.value);
          }}
          onBlur={() => props.onBlur?.()}
        />
        {/* The name stays "Show password"; aria-pressed carries the state. */}
        <button
          type="button"
          aria-label={t(messages.uiPasswordToggleLabel)}
          aria-pressed={shown() ? "true" : "false"}
          class="absolute inset-y-0 end-0 inline-flex min-w-11 items-center gap-1 rounded-control px-3 text-sm font-semibold text-accent-fg hover:underline"
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => setShown(!shown())}
        >
          <Icon name={shown() ? "eye-off" : "eye"} class="size-5" />
          {shown() ? t(messages.uiPasswordHide) : t(messages.uiPasswordShow)}
        </button>
      </div>
    </FieldShell>
  );
}
