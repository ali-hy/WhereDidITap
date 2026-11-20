// F-156: S-2, the second step of a sign-in.
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { useI18n } from "../../i18n/useI18n.js";
import { RateLimitNotice, createRateLimitGate } from "../../ui/RateLimitNotice.js";
import { SignedOutColumn } from "../../ui/SignedOutColumn.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { showToast } from "../../ui/Toaster.js";
import { TwoStepForm, type TwoStepResult, type TwoStepValue } from "../components/TwoStepForm.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";
import { safeNext } from "../routes/guards.js";
import { useSession } from "../session/SessionProvider.js";

/** `/sign-in` with a reason, keeping a non-default `next`. */
function signInHref(reason: string, next: string): string {
  return next === "/"
    ? `/sign-in?reason=${reason}`
    : `/sign-in?reason=${reason}&next=${encodeURIComponent(next)}`;
}

export function TwoStepPage(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const session = useSession();
  const navigate = useNavigate();
  const search: () => { next?: unknown } = useSearch({ strict: false });
  const gate = createRateLimitGate();
  const [busy, setBusy] = createSignal(false);
  const [limitedCode, setLimitedCode] = createSignal(false);
  const [recoveryMode, setRecoveryMode] = createSignal(false);
  const [summary, setSummary] = createSignal<{ text: string }[]>([]);

  createEffect(() => {
    setDocumentTitle(t(m.twostepTitle), t);
  });

  // The router focuses and announces the <h1> after arriving; the field takes focus after it.
  onMount(() => {
    const timer = setTimeout(() => {
      document.getElementById("twostep-code")?.focus();
    }, 100);
    onCleanup(() => {
      clearTimeout(timer);
    });
  });

  const next = (): string => {
    const value = search().next;
    return typeof value === "string" ? safeNext(value) : "/";
  };

  const submit = async (value: TwoStepValue): Promise<TwoStepResult> => {
    setSummary([]);
    if (busy()) return;
    // The rate limit is on authenticator codes; recovery codes still go through.
    if (value.code !== undefined && gate.blockedFor() > 0) return;
    setBusy(true);
    try {
      const result = await api.auth.verifyTwoStep({ ...value, tokenDelivery: "cookie" });
      if (result.status !== "signed_in") return;
      await session.markSignedIn();
      await navigate({ href: next() });
      const left = result.recoveryCodesLeft;
      if (typeof left === "number") {
        // J-5: with 3 or fewer left the toast stays, with an action to create new codes.
        const low = left <= 3;
        showToast({
          tone: "info",
          message: t(m.twostepRecoveryLeft, { n: left }),
          ...(low
            ? {
                persistent: true,
                action: {
                  label: t(m.twostepCreateNew),
                  onClick: () =>
                    void navigate({ to: "/settings/security", search: { newCodes: 1 } }),
                },
              }
            : {}),
        });
      }
    } catch (err) {
      const error = toAppError(err);
      if (error.kind === "defined" && error.key === "TWO_STEP_CODE_INVALID") {
        return t(m.twostepCodeWrong);
      }
      if (error.kind === "defined" && error.key === "TWO_STEP_CHALLENGE_EXPIRED") {
        const reason = (error.data as { reason?: unknown } | undefined)?.reason;
        await navigate({
          href: signInHref(
            reason === "too_many_attempts" ? "two_step_too_many" : "two_step_timeout",
            next(),
          ),
        });
        return;
      }
      if (error.kind === "defined" && error.key === "RATE_LIMITED") {
        const seconds = (error.data as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        setLimitedCode(value.code !== undefined);
        gate.block(typeof seconds === "number" ? seconds : undefined);
        return;
      }
      const { descriptor, values } = identityErrorMessage(error, "read");
      setSummary([{ text: t(descriptor, values) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignedOutColumn>
      <div class="flex flex-col gap-4">
        <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
          {t(m.twostepTitle)}
        </h1>
        <p class="text-fg">{t(m.twostepPrompt)}</p>
        <FormErrorSummary messages={summary()} />
        <Show when={!recoveryMode()}>
          <RateLimitNotice secondsLeft={gate.blockedFor()} />
          <Show when={gate.blockedFor() > 0 && limitedCode()}>
            <p class="text-fg">{t(m.twostepLimitRecovery)}</p>
          </Show>
        </Show>
        <TwoStepForm onSubmit={submit} allowRecovery busy={busy()} onModeChange={setRecoveryMode} />
        <details>
          <summary class="cursor-pointer text-accent-fg">{t(m.twostepLostHelp)}</summary>
          <p class="mt-2 text-fg-muted">{t(m.twostepLostHelpBody)}</p>
        </details>
        <p>
          <a href="/sign-in">{t(m.twostepBack)}</a>
        </p>
      </div>
    </SignedOutColumn>
  );
}
