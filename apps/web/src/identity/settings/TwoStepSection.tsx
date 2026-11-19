// F-164: S-10's two-step section (J-7, J-21): status, turn on or off, new codes, a new phone.
import { AlertDialog } from "@kobalte/core/alert-dialog";
import { Dialog } from "@kobalte/core/dialog";
import { createQuery } from "@tanstack/solid-query";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal, Match, Show, Switch, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { messages } from "../../i18n/messages.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { Icon } from "../../ui/icons/Icon.js";
import { Skeleton } from "../../ui/Skeleton.js";
import { showToast } from "../../ui/Toaster.js";
import { withConfirmation } from "../components/ConfirmItsYou.js";
import { RecoveryCodesView } from "../components/RecoveryCodesView.js";
import { TwoStepForm, type TwoStepResult, type TwoStepValue } from "../components/TwoStepForm.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";

const OVERLAY = "fixed inset-0 bg-fg/40";
const CONTENT =
  "w-full max-w-[26.25rem] rounded-card border border-line bg-surface-raised p-6 shadow-overlay";

export function TwoStepSection(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const status = createQuery(() => ({
    queryKey: ["security", "two-step"],
    queryFn: async () => (await api.me.get()).twoStep,
    retry: false,
    staleTime: 0,
  }));
  const [offOpen, setOffOpen] = createSignal(false);
  const [offBusy, setOffBusy] = createSignal(false);
  const [codes, setCodes] = createSignal<readonly string[] | null>(null);
  const [codesBusy, setCodesBusy] = createSignal(false);
  const [newCodesBusy, setNewCodesBusy] = createSignal(false);

  const fail = (e: unknown): void => {
    const { descriptor, values } = identityErrorMessage(toAppError(e), "mutation");
    showToast({ tone: "error", message: t(descriptor, values) });
  };

  const turnOff = async (value: TwoStepValue): Promise<TwoStepResult> => {
    setOffBusy(true);
    try {
      await api.me.twoStepDisable(value);
      setOffOpen(false);
      showToast({ tone: "success", message: t(m.twostepOffDone) });
      await status.refetch();
    } catch (e) {
      const app = toAppError(e);
      if (app.kind === "defined" && app.key === "TWO_STEP_CODE_INVALID") {
        return t(m.twostepCodeWrong);
      }
      setOffOpen(false);
      fail(e);
    } finally {
      setOffBusy(false);
    }
  };

  const createNew = async (): Promise<void> => {
    setNewCodesBusy(true);
    try {
      const result = await withConfirmation(() => api.me.regenerateRecoveryCodes({}));
      if (result !== undefined) setCodes(result.recoveryCodes);
    } catch (e) {
      fail(e);
    } finally {
      setNewCodesBusy(false);
    }
  };

  const codesDone = async (): Promise<void> => {
    setCodesBusy(true);
    try {
      await api.me.acknowledgeRecoveryCodes({});
      setCodes(null);
      await status.refetch();
    } catch (e) {
      fail(e);
    } finally {
      setCodesBusy(false);
    }
  };

  return (
    <section class="mt-6" aria-busy={status.isPending ? "true" : undefined}>
      <h2 class="text-lg font-semibold text-fg">{t(m.twostepTitle)}</h2>
      <Switch>
        <Match when={status.isPending}>
          <div class="mt-4">
            <Skeleton rows={1} shape="row" />
          </div>
        </Match>
        <Match when={status.isError}>
          <p class="mt-4 text-fg">
            {(() => {
              const { descriptor, values } = identityErrorMessage(toAppError(status.error), "read");
              return t(descriptor, values);
            })()}
          </p>
          <div class="mt-4">
            <Button variant="secondary" onClick={() => void status.refetch()}>
              {t(messages.errorFallbackRetry)}
            </Button>
          </div>
        </Match>
        <Match when={status.data}>
          {(data) => (
            <div class="mt-3 flex flex-col gap-3">
              <p class="text-fg">
                <span class="font-medium">
                  {t(data().enabled ? m.twostepStatusOn : m.twostepStatusOff)}
                </span>
              </p>
              <Show when={data().enabled && !data().codesAcknowledged}>
                <p class="flex items-center gap-2 text-fg">
                  <Icon name="alert" class="size-5 shrink-0 text-warning" />
                  {t(m.twostepCodesUnsaved)}
                </p>
              </Show>
              <div class="flex flex-wrap gap-2" data-button-row>
                <Show
                  when={data().enabled}
                  fallback={
                    <Button
                      variant="secondary"
                      onClick={() => void navigate({ to: "/settings/security/two-step" })}
                    >
                      {t(m.twostepTurnOn)}
                    </Button>
                  }
                >
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOffOpen(true);
                    }}
                  >
                    {t(m.twostepOff)}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void navigate({
                        to: "/settings/security/two-step",
                        search: { mode: "replace" },
                      })
                    }
                  >
                    {t(m.twostepReplace)}
                  </Button>
                  <Button
                    variant="secondary"
                    busy={newCodesBusy()}
                    onClick={() => void createNew()}
                  >
                    {t(m.twostepCreateNew)}
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </Match>
      </Switch>

      <AlertDialog open={offOpen()} onOpenChange={setOffOpen} modal>
        <AlertDialog.Portal>
          <AlertDialog.Overlay class={OVERLAY} />
          <div class="fixed inset-0 z-10 flex items-center justify-center p-4">
            <AlertDialog.Content class={CONTENT}>
              <div class="flex flex-col gap-4">
                <AlertDialog.Title class="text-2xl font-semibold text-fg">
                  {t(m.twostepTitle)}
                </AlertDialog.Title>
                <AlertDialog.Description class="text-fg">
                  {t(m.twostepOffConfirm)}
                </AlertDialog.Description>
                <TwoStepForm
                  onSubmit={turnOff}
                  allowRecovery
                  busy={offBusy()}
                  submitLabel={m.twostepOff}
                  actions={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOffOpen(false);
                      }}
                    >
                      {t(m.confirmCancel)}
                    </Button>
                  }
                />
              </div>
            </AlertDialog.Content>
          </div>
        </AlertDialog.Portal>
      </AlertDialog>

      <Dialog
        open={codes() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCodes(null);
            void status.refetch();
          }
        }}
        modal
      >
        <Dialog.Portal>
          <Dialog.Overlay class={OVERLAY} />
          <div class="fixed inset-0 z-10 flex items-center justify-center p-4">
            <Dialog.Content class={`${CONTENT} max-h-full overflow-y-auto`}>
              <Dialog.Title class="mb-4 text-2xl font-semibold text-fg">
                {t(m.twostepCodesTitle)}
              </Dialog.Title>
              <RecoveryCodesView
                codes={codes() ?? []}
                notice={t(m.twostepNewCodesDone)}
                busy={codesBusy()}
                onDone={() => void codesDone()}
              />
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </section>
  );
}
