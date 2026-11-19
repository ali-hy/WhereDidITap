// F-155: the sign-in page. S-1 had the shell; S-3 adds the form.
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { PasswordField } from "../../ui/PasswordField.js";
import { RateLimitNotice, createRateLimitGate } from "../../ui/RateLimitNotice.js";
import { SignedOutColumn } from "../../ui/SignedOutColumn.js";
import { TextField } from "../../ui/TextField.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";
import { safeNext } from "../routes/guards.js";
import { useSession } from "../session/SessionProvider.js";

const LAST_EMAIL_KEY = "budmon.lastEmail";

function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Blocked storage: the field just isn't prefilled next time.
  }
}

const FIELD = { email: "signin-email", password: "signin-password" } as const;

export function SignInPage(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const session = useSession();
  const navigate = useNavigate();
  const search: () => { reason?: unknown; next?: unknown } = useSearch({ strict: false });
  const gate = createRateLimitGate();

  const [email, setEmail] = createSignal(lastEmail());
  const [password, setPassword] = createSignal("");
  const [errors, setErrors] = createSignal<{
    email?: string | undefined;
    password?: string | undefined;
  }>({});
  const [summary, setSummary] = createSignal<{ text: string }[]>([]);
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    setDocumentTitle(t(m.signinTitle), t);
  });

  const emailProblem = (): string | undefined => {
    const value = email().trim();
    if (value === "") return t(m.formEmailRequired);
    return value.includes("@") ? undefined : t(m.formEmailInvalid);
  };
  const passwordProblem = (): string | undefined =>
    password() === "" ? t(m.formPasswordRequired) : undefined;

  const validate = (): boolean => {
    const found = { email: emailProblem(), password: passwordProblem() };
    setErrors(found);
    if (found.email !== undefined) {
      document.getElementById(FIELD.email)?.focus();
      return false;
    }
    if (found.password !== undefined) {
      document.getElementById(FIELD.password)?.focus();
      return false;
    }
    return true;
  };

  const next = (): string => {
    const value = search().next;
    return typeof value === "string" ? safeNext(value) : "/";
  };

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    setSummary([]);
    if (busy() || gate.blockedFor() > 0 || !validate()) return;
    setBusy(true);
    try {
      const result = await api.auth.signIn({
        email: email().trim(),
        password: password(),
        tokenDelivery: "cookie",
      });
      rememberEmail(email().trim());
      if (result.status === "two_step_required") {
        await navigate({
          href:
            next() === "/"
              ? "/sign-in/two-step"
              : `/sign-in/two-step?next=${encodeURIComponent(next())}`,
        });
        return;
      }
      await session.markSignedIn();
      await navigate({ href: next() });
    } catch (err) {
      const error = toAppError(err);
      if (error.kind === "defined" && error.key === "RATE_LIMITED") {
        const seconds = (error.data as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        gate.block(typeof seconds === "number" ? seconds : undefined);
        return;
      }
      // A sign-in changes nothing the person must check, so failures read as `read` (A-75).
      const { descriptor, values } = identityErrorMessage(error, "read");
      setSummary([{ text: t(descriptor, values) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignedOutColumn>
      <form class="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
          {t(m.signinTitle)}
        </h1>
        <Show when={search().reason === "ended"}>
          <p role="status" class="text-fg">
            {t(m.signinSessionEnded)}
          </p>
        </Show>
        <Show when={search().reason === "two_step_too_many"}>
          <p role="status" class="text-fg">
            {t(m.twostepTooMany)}
          </p>
        </Show>
        <Show when={search().reason === "two_step_timeout"}>
          <p role="status" class="text-fg">
            {t(m.twostepTimeout)}
          </p>
        </Show>
        <Show when={search().reason === "reuse"}>
          <p role="status" class="text-fg">
            {t(m.signinReuse)}
          </p>
        </Show>
        <p class="text-fg-muted">{t(m.signinInviteOnly)}</p>
        <FormErrorSummary messages={summary()} />
        <RateLimitNotice secondsLeft={gate.blockedFor()} />
        <TextField
          id={FIELD.email}
          type="email"
          label={t(m.signinEmail)}
          autocomplete="username"
          value={email()}
          readonly={busy()}
          onInput={(v) => {
            setEmail(v);
            if (errors().email !== undefined) setErrors((x) => ({ ...x, email: emailProblem() }));
          }}
          onBlur={() => {
            if (email() !== "") setErrors((x) => ({ ...x, email: emailProblem() }));
          }}
          error={errors().email}
        />
        <PasswordField
          id={FIELD.password}
          label={t(m.signinPassword)}
          autocomplete="current-password"
          value={password()}
          readonly={busy()}
          onInput={(v) => {
            setPassword(v);
            if (errors().password !== undefined) {
              setErrors((x) => ({ ...x, password: passwordProblem() }));
            }
          }}
          error={errors().password}
        />
        <div data-button-row>
          <Button
            variant="primary"
            type="submit"
            fullWidth
            busy={busy()}
            disabled={gate.blockedFor() > 0}
          >
            {t(m.signinSubmit)}
          </Button>
        </div>
      </form>
      <p class="mt-4">
        <a href="/privacy">{t(m.signinPrivacy)}</a>
      </p>
    </SignedOutColumn>
  );
}
