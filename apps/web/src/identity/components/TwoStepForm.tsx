// F-156: the code form shared by sign-in (S-2) and the step-up dialog (F-166).
import type { MessageDescriptor } from "@formatjs/intl";
import { createSignal, onMount, Show, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { CodeField } from "../../ui/CodeField.js";
import { identityMessages as m } from "../messages.js";

export interface TwoStepValue {
  code?: string;
  recoveryCode?: string;
}

/** A message to show on the field (cleared and refocused), or nothing. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- keeps `Promise<void>` handlers assignable
export type TwoStepResult = void | string;

export interface TwoStepFormProps {
  /** Resolves with a message to show on the field (the field is then cleared and refocused). */
  onSubmit: (v: TwoStepValue) => Promise<TwoStepResult>;
  allowRecovery: boolean;
  busy: boolean;
  /** The button's label; `twostep.verify` by default. */
  submitLabel?: MessageDescriptor;
  /** Placed after the submit button. */
  actions?: JSX.Element;
  /** Focus the field on mount. */
  autofocus?: boolean;
}

const FIELD_ID = "twostep-code";

export function TwoStepForm(props: TwoStepFormProps): JSX.Element {
  const { t } = useI18n();
  const [recovery, setRecovery] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [error, setError] = createSignal<string | undefined>(undefined);

  const focusField = (): void => {
    document.getElementById(FIELD_ID)?.focus();
  };
  onMount(() => {
    if (props.autofocus === true) focusField();
  });

  const digits = (): string => value().replace(/\s+/g, "");
  const recoveryText = (): string => value().trim();
  const problem = (): string | undefined => {
    if (recovery()) {
      return /^[A-Za-z2-7]{12}$/.test(recoveryText().replace(/[-\s]/g, ""))
        ? undefined
        : t(m.twostepRecoveryInvalid);
    }
    return /^\d{6}$/.test(digits()) ? undefined : t(m.twostepCodeInvalid);
  };

  const switchTo = (toRecovery: boolean): void => {
    setRecovery(toRecovery);
    setValue("");
    setError(undefined);
    queueMicrotask(focusField);
  };

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    if (props.busy) return;
    const found = problem();
    setError(found);
    if (found !== undefined) {
      focusField();
      return;
    }
    const shown = await props.onSubmit(
      recovery() ? { recoveryCode: recoveryText() } : { code: digits() },
    );
    if (typeof shown === "string") {
      setValue("");
      setError(shown);
      queueMicrotask(focusField);
    }
  };

  return (
    <form class="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <CodeField
        id={FIELD_ID}
        label={t(recovery() ? m.twostepRecovery : m.twostepCode)}
        kind={recovery() ? "text" : "numeric"}
        value={value()}
        readonly={props.busy}
        error={error()}
        onInput={(v) => {
          setValue(v);
          if (error() !== undefined) setError(undefined);
        }}
      />
      <Show when={props.allowRecovery}>
        <div>
          <Button
            variant="tertiary"
            onClick={() => {
              switchTo(!recovery());
            }}
          >
            {t(recovery() ? m.twostepUseCode : m.twostepUseRecovery)}
          </Button>
        </div>
      </Show>
      <div class="flex gap-2" data-button-row>
        <Button variant="primary" type="submit" busy={props.busy}>
          {t(props.submitLabel ?? m.twostepVerify)}
        </Button>
        {props.actions}
      </div>
    </form>
  );
}
