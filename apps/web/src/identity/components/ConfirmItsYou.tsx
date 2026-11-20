// F-166: the step-up dialog and `withConfirmation`. The password and two-step code factors are
// here; the Google factor arrives with S-6.
import * as Dialog from "@kobalte/core/dialog";
import { createSignal, Show, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { PasswordField } from "../../ui/PasswordField.js";
import { RateLimitNotice, createRateLimitGate } from "../../ui/RateLimitNotice.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { identityErrorMessage } from "../errorMessages.js";
import { TwoStepForm, type TwoStepResult, type TwoStepValue } from "./TwoStepForm.js";
import { identityMessages as m } from "../messages.js";

type Factor = "password" | "two_step";
type Pending = { factor: Factor; resolve: (confirmed: boolean) => void };
const [pending, setPending] = createSignal<Pending | null>(null);

/** The dialog that is open now, as a promise of whether the person confirmed. */
let open: Promise<boolean> | null = null;

/** Opens the dialog, or joins the one already open; resolves with whether the person confirmed. */
function ask(factor: Factor): Promise<boolean> {
  open ??= new Promise<boolean>((resolve) => {
    setPending({
      factor,
      resolve: (confirmed) => {
        open = null;
        resolve(confirmed);
      },
    });
  });
  return open;
}

/**
 * Runs `run()`. On CONFIRMATION_REQUIRED it asks the person to confirm, then runs it once more;
 * cancelling gives `undefined`. Calls that arrive while the dialog is open share its outcome:
 * each runs once more on a confirmation (in call order), or gives `undefined` on a cancel.
 */
export async function withConfirmation<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    const error = toAppError(e);
    if (error.kind !== "defined" || error.key !== "CONFIRMATION_REQUIRED") throw e;
    const factor = (error.data as { factor?: unknown } | undefined)?.factor;
    // The Google factor has its dialog in S-6.
    if (factor !== "password" && factor !== "two_step") throw e;
    if (!(await ask(factor))) return undefined;
    return await run();
  }
}

/** One instance, mounted once; it opens when `withConfirmation` asks. */
export function ConfirmItsYouDialog(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const gate = createRateLimitGate();
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [summary, setSummary] = createSignal<{ text: string }[]>([]);
  const [busy, setBusy] = createSignal(false);

  const finish = (confirmed: boolean): void => {
    pending()?.resolve(confirmed);
    setPending(null);
    setPassword("");
    setError(undefined);
    setSummary([]);
  };

  const submitCode = async (value: TwoStepValue): Promise<TwoStepResult> => {
    if (busy()) return;
    setSummary([]);
    if (value.code !== undefined && gate.blockedFor() > 0) return;
    setBusy(true);
    try {
      await api.me.confirm(value);
      finish(true);
    } catch (err) {
      const app = toAppError(err);
      if (app.kind === "defined" && app.key === "TWO_STEP_CODE_INVALID") {
        return t(m.twostepCodeWrong);
      }
      if (app.kind === "defined" && app.key === "RATE_LIMITED") {
        const seconds = (app.data as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        gate.block(typeof seconds === "number" ? seconds : undefined);
        return;
      }
      const { descriptor, values } = identityErrorMessage(app, "read");
      setSummary([{ text: t(descriptor, values) }]);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    if (busy() || gate.blockedFor() > 0) return;
    setError(undefined);
    setSummary([]);
    if (password() === "") {
      setError(t(m.formPasswordRequired));
      return;
    }
    setBusy(true);
    try {
      await api.me.confirm({ password: password() });
      finish(true);
    } catch (err) {
      const app = toAppError(err);
      if (app.kind === "defined" && app.key === "RATE_LIMITED") {
        const seconds = (app.data as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        gate.block(typeof seconds === "number" ? seconds : undefined);
      } else if (app.kind === "defined" && app.key === "INVALID_CREDENTIALS") {
        setError(t(m.errorInvalidCredentials));
      } else {
        const { descriptor, values } = identityErrorMessage(app, "read");
        setSummary([{ text: t(descriptor, values) }]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={pending() !== null}
      onOpenChange={(open) => {
        if (!open && !busy()) finish(false);
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 bg-fg/40" />
        <div class="fixed inset-0 z-10 flex items-center justify-center p-4">
          <Dialog.Content class="w-full max-w-[26.25rem] rounded-card border border-line bg-surface-raised p-6 shadow-overlay">
            <div class="flex flex-col gap-4">
              <Dialog.Title class="text-2xl font-semibold text-fg">
                {t(m.confirmTitle)}
              </Dialog.Title>
              <FormErrorSummary messages={summary()} />
              <RateLimitNotice secondsLeft={gate.blockedFor()} />
              <Show
                when={pending()?.factor === "two_step"}
                fallback={
                  <form class="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
                    <PasswordField
                      id="confirm-password"
                      label={t(m.confirmPassword)}
                      autocomplete="current-password"
                      value={password()}
                      readonly={busy()}
                      onInput={setPassword}
                      error={error()}
                    />
                    <div class="flex gap-2" data-button-row>
                      <Button
                        variant="primary"
                        type="submit"
                        busy={busy()}
                        disabled={gate.blockedFor() > 0}
                      >
                        {t(m.confirmSubmit)}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy()}
                        onClick={() => {
                          finish(false);
                        }}
                      >
                        {t(m.confirmCancel)}
                      </Button>
                    </div>
                  </form>
                }
              >
                <TwoStepForm
                  onSubmit={submitCode}
                  allowRecovery
                  busy={busy()}
                  submitLabel={m.confirmSubmit}
                  actions={
                    <Button
                      variant="secondary"
                      disabled={busy()}
                      onClick={() => {
                        finish(false);
                      }}
                    >
                      {t(m.confirmCancel)}
                    </Button>
                  }
                />
              </Show>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
