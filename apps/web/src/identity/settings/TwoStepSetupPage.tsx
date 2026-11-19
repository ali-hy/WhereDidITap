// F-165: S-11, turning two-step on (J-7) and moving it to a new phone (J-21, `mode: "replace"`).
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { createEffect, createSignal, Match, onMount, Show, Switch, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { messages } from "../../i18n/messages.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { Skeleton } from "../../ui/Skeleton.js";
import { showToast } from "../../ui/Toaster.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { QrCode } from "../components/QrCode.js";
import { RecoveryCodesView } from "../components/RecoveryCodesView.js";
import { withConfirmation } from "../components/ConfirmItsYou.js";
import { TwoStepForm, type TwoStepResult, type TwoStepValue } from "../components/TwoStepForm.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";

interface SetupInfo {
  secret: string;
  otpauthUri: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; text: string }
  | { kind: "expired" }
  | { kind: "scan"; info: SetupInfo }
  | { kind: "codes"; codes: readonly string[] };

export function TwoStepSetupPage(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const search: () => { mode?: unknown } = useSearch({ strict: false });
  const replace = (): boolean => search().mode === "replace";
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" });
  const [busy, setBusy] = createSignal(false);
  const [summary, setSummary] = createSignal<{ text: string }[]>([]);

  createEffect(() => {
    setDocumentTitle(t(replace() ? m.twostepReplace : m.twostepSetupTitle), t);
  });

  const backToSecurity = (): Promise<void> => navigate({ to: "/settings/security", replace: true });

  const keyOf = (e: unknown): string | undefined => {
    const app = toAppError(e);
    return app.kind === "defined" ? app.key : undefined;
  };

  /** Starts (or restarts) the setup: a fresh secret and QR code. */
  const start = async (): Promise<void> => {
    setPhase({ kind: "loading" });
    setSummary([]);
    try {
      const info = await withConfirmation(() =>
        replace() ? api.me.twoStepReplaceStart({}) : api.me.twoStepSetup({}),
      );
      if (info === undefined) {
        await backToSecurity();
        return;
      }
      setPhase({ kind: "scan", info });
    } catch (e) {
      const key = keyOf(e);
      // A reload after turning on lands here: the codes are gone, S-10 says so.
      if (key === "TWO_STEP_ALREADY_ENABLED" || key === "TWO_STEP_NOT_ENABLED") {
        await backToSecurity();
        return;
      }
      const { descriptor, values } = identityErrorMessage(toAppError(e), "read");
      setPhase({ kind: "failed", text: t(descriptor, values) });
    }
  };
  onMount(() => {
    void start();
  });

  const confirm = async (value: TwoStepValue): Promise<TwoStepResult> => {
    const code = value.code ?? "";
    setBusy(true);
    setSummary([]);
    try {
      if (replace()) {
        const done = await withConfirmation(() => api.me.twoStepReplaceConfirm({ code }));
        if (done === undefined) return;
        showToast({ tone: "success", message: t(m.twostepReplaced) });
        await backToSecurity();
        return;
      }
      const result = await withConfirmation(() => api.me.twoStepEnable({ code }));
      if (result === undefined) return;
      setPhase({ kind: "codes", codes: result.recoveryCodes });
    } catch (e) {
      const key = keyOf(e);
      if (key === "TWO_STEP_CODE_INVALID") return t(m.twostepSetupClockHint);
      if (key === "TWO_STEP_SETUP_EXPIRED") {
        setPhase({ kind: "expired" });
        return;
      }
      if (key === "TWO_STEP_ALREADY_ENABLED") {
        await backToSecurity();
        return;
      }
      const { descriptor, values } = identityErrorMessage(toAppError(e), "mutation");
      setSummary([{ text: t(descriptor, values) }]);
    } finally {
      setBusy(false);
    }
  };

  const done = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.me.acknowledgeRecoveryCodes({});
      showToast({ tone: "success", message: t(m.twostepOn) });
      await backToSecurity();
    } catch (e) {
      const { descriptor, values } = identityErrorMessage(toAppError(e), "mutation");
      setSummary([{ text: t(descriptor, values) }]);
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async (secret: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(secret.replace(/\s+/g, ""));
      showToast({ tone: "success", message: t(m.twostepCopied) });
    } catch {
      // Clipboard blocked: the key stays on screen to type.
    }
  };

  const step = (n: number): string => t(m.twostepSetupStep, { n });

  return (
    <div class="max-w-[34rem]">
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(replace() ? m.twostepReplace : m.twostepSetupTitle)}
      </h1>
      <div class="mt-4 flex flex-col gap-4">
        <FormErrorSummary messages={summary()} />
        <Switch>
          <Match when={phase().kind === "loading"}>
            <div aria-busy="true">
              <Skeleton rows={4} shape="row" />
            </div>
          </Match>
          <Match when={phase().kind === "failed"}>
            <p class="text-fg">{(phase() as { text: string }).text}</p>
            <div data-button-row>
              <Button variant="secondary" onClick={() => void start()}>
                {t(messages.errorFallbackRetry)}
              </Button>
            </div>
          </Match>
          <Match when={phase().kind === "expired"}>
            <p role="status" class="text-fg">
              {t(m.twostepSetupExpired)}
            </p>
            <div data-button-row>
              <Button variant="secondary" onClick={() => void start()}>
                {t(m.twostepSetupStartAgain)}
              </Button>
            </div>
          </Match>
          <Match when={phase().kind === "scan"}>
            {(() => {
              const info = (): SetupInfo => (phase() as { info: SetupInfo }).info;
              return (
                <>
                  <Show when={!replace()}>
                    <p class="text-fg-muted">{step(1)}</p>
                  </Show>
                  <p class="text-fg">{t(m.twostepSetupSteps)}</p>
                  <QrCode text={info().otpauthUri} alt={t(m.twostepQrAlt)} />
                  <div>
                    <p class="text-fg">{t(m.twostepSetupCantScan)}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <code dir="ltr" class="font-mono text-lg tracking-wider text-fg">
                        {info().secret}
                      </code>
                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => void copyKey(info().secret)}
                      >
                        {t(m.twostepSetupCopy)}
                      </Button>
                    </div>
                  </div>
                  <TwoStepForm
                    onSubmit={confirm}
                    allowRecovery={false}
                    busy={busy()}
                    submitLabel={m.twostepSetupSubmit}
                    autofocus={false}
                  />
                </>
              );
            })()}
          </Match>
          <Match when={phase().kind === "codes"}>
            <p class="text-fg-muted">{step(2)}</p>
            <h2 class="text-lg font-semibold text-fg">{t(m.twostepCodesTitle)}</h2>
            <RecoveryCodesView
              codes={(phase() as { codes: readonly string[] }).codes}
              busy={busy()}
              onDone={() => void done()}
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
