// F-159 (S-1): the invitation page, password path. States: checking, join, setup, problem.
import { Temporal } from "@budmon/shared";
import { useNavigate } from "@tanstack/solid-router";
import { createEffect, createSignal, Match, onMount, Show, Switch, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError, type AppError } from "../../api/errors.js";
import { messages } from "../../i18n/messages.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { ComboboxField, type ComboboxOption } from "../../ui/ComboboxField.js";
import { PasswordField } from "../../ui/PasswordField.js";
import { Skeleton } from "../../ui/Skeleton.js";
import { SignedOutColumn } from "../../ui/SignedOutColumn.js";
import { TextField } from "../../ui/TextField.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { defaultCurrencyFor, deviceTimeZone, timeZoneOptions } from "../defaults.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";
import { readFragmentToken } from "../session/fragment.js";
import { useSession } from "../session/SessionProvider.js";

const STORE_KEY = "budmon.invite";
const KEEP_MS = 30 * 60 * 1000;
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;
const MAX_NAME = 80;

interface Preview {
  email: string;
  inviterName: string | null;
  expiresAt: string;
  origin: "direct" | "account_share" | "bootstrap";
}

interface Options {
  currencies: readonly string[];
  locales: readonly string[];
}

type Problem =
  | { kind: "expired"; at: string }
  | { kind: "revoked" }
  | { kind: "used"; recent: boolean }
  | { kind: "invalid" }
  | { kind: "incomplete" }
  | { kind: "failed"; error: AppError };

type View =
  | { name: "checking" }
  | { name: "join" }
  | { name: "setup" }
  | { name: "problem"; problem: Problem };

/** The token kept for reloads, for 30 minutes. */
function loadStoredToken(): string | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw === null) return null;
    const { t, at } = JSON.parse(raw) as { t?: unknown; at?: unknown };
    if (typeof t === "string" && typeof at === "number" && Date.now() - at < KEEP_MS) return t;
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Unreadable storage: the link in the address bar is all there is.
  }
  return null;
}

function storeToken(token: string): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ t: token, at: Date.now() }));
  } catch {
    // Blocked storage: a reload loses the token.
  }
}

function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Code points, so an emoji counts once (the server counts the same way). */
const length = (s: string): number => Array.from(s).length;

function problemOf(e: unknown): Problem {
  const error = toAppError(e);
  if (error.kind !== "defined") return { kind: "failed", error };
  const data = (error.data ?? {}) as { expiredAt?: unknown; recent?: unknown };
  switch (error.key) {
    case "INVITATION_EXPIRED":
      return { kind: "expired", at: typeof data.expiredAt === "string" ? data.expiredAt : "" };
    case "INVITATION_REVOKED":
      return { kind: "revoked" };
    case "INVITATION_USED":
      return { kind: "used", recent: data.recent === true };
    case "INVITATION_INVALID":
      return { kind: "invalid" };
    default:
      return { kind: "failed", error };
  }
}

export function InvitePage(): JSX.Element {
  const { t, locale } = useI18n();
  const api = useApi();
  const session = useSession();
  const navigate = useNavigate();

  const [view, setView] = createSignal<View>({ name: "checking" });
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [options, setOptions] = createSignal<Options>({ currencies: [], locales: [] });
  let token = null as string | null;

  const title = (): string => {
    const v = view();
    if (v.name === "checking") return t(m.inviteChecking);
    if (v.name === "setup") return t(m.setupTitle);
    if (v.name === "problem") return t(m.inviteProblemTitle);
    return t(m.inviteTitle);
  };
  createEffect(() => {
    setDocumentTitle(title(), t);
  });

  const check = async (): Promise<void> => {
    setView({ name: "checking" });
    if (token === null) {
      setView({ name: "problem", problem: { kind: "incomplete" } });
      return;
    }
    try {
      const result = await api.invitations.preview({ token });
      setPreview(result);
      setView({ name: "join" });
    } catch (e) {
      setView({ name: "problem", problem: problemOf(e) });
    }
  };

  onMount(() => {
    const fromFragment = readFragmentToken("t");
    if (fromFragment !== null) storeToken(fromFragment);
    token = fromFragment ?? loadStoredToken();
    void check();
  });

  const openSetup = async (): Promise<void> => {
    if (options().currencies.length === 0) {
      try {
        const result = await api.auth.signUpOptions();
        setOptions({
          currencies: result.currencies.map((c) => c.code),
          locales: result.locales,
        });
      } catch (e) {
        setView({ name: "problem", problem: { kind: "failed", error: toAppError(e) } });
        return;
      }
    }
    setView({ name: "setup" });
  };

  const inviterName = (): string => preview()?.inviterName ?? "";
  const date = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat(locale(), { dateStyle: "long" }).format(
        new Date(Temporal.Instant.from(iso).epochMilliseconds),
      );
    } catch {
      return iso;
    }
  };

  return (
    <SignedOutColumn>
      <Switch>
        <Match when={view().name === "checking"}>
          <div aria-busy="true">
            <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
              {t(m.inviteChecking)}
            </h1>
            <div class="mt-4">
              <Skeleton rows={3} />
            </div>
          </div>
        </Match>
        <Match when={view().name === "join"}>
          <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
            {t(m.inviteTitle)}
          </h1>
          <Show when={preview()}>
            {(p) => (
              <>
                <p class="mt-3 text-fg">
                  {p().origin === "bootstrap"
                    ? t(m.inviteFromOwner, { email: p().email })
                    : t(m.inviteFrom, { inviter: inviterName(), email: p().email })}
                </p>
                <p class="mt-2 text-fg-muted">
                  {t(m.inviteExpires, { date: date(p().expiresAt) })}
                </p>
              </>
            )}
          </Show>
          <div class="mt-6">
            <Button variant="primary" fullWidth onClick={() => void openSetup()}>
              {t(m.inviteUsePassword)}
            </Button>
          </div>
          <p class="mt-4 text-center">
            <a href="/sign-in">{t(m.inviteHaveAccount)}</a>
          </p>
        </Match>
        <Match when={view().name === "setup"}>
          <SetupForm
            preview={preview()}
            options={options()}
            token={token ?? ""}
            onProblem={(problem) => setView({ name: "problem", problem })}
            onDone={async () => {
              clearStoredToken();
              await session.markSignedIn();
              await navigate({ to: "/" });
            }}
            inviterName={inviterName()}
          />
        </Match>
        <Match when={view().name === "problem"}>
          <ProblemView
            view={view() as Extract<View, { name: "problem" }>}
            inviter={inviterName()}
            date={date}
            onRetry={() => void check()}
          />
        </Match>
      </Switch>
    </SignedOutColumn>
  );
}

function ProblemView(props: {
  view: Extract<View, { name: "problem" }>;
  inviter: string;
  date: (iso: string) => string;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const problem = () => props.view.problem;
  const text = (): string => {
    const p = problem();
    switch (p.kind) {
      case "expired":
        return t(m.inviteProblemExpired, { date: props.date(p.at) });
      case "revoked":
        return t(m.inviteProblemRevoked);
      case "used":
        return p.recent ? t(m.inviteProblemReady) : t(m.inviteProblemUsed);
      case "invalid":
        return t(m.inviteProblemInvalid);
      case "incomplete":
        return t(m.inviteProblemIncomplete);
      case "failed": {
        const { descriptor, values } = identityErrorMessage(p.error, "read");
        return t(descriptor, values);
      }
    }
  };
  const canAsk = () => {
    const kind = problem().kind;
    return (kind === "expired" || kind === "revoked") && props.inviter !== "";
  };
  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(m.inviteProblemTitle)}
      </h1>
      <p class="mt-3 text-fg">{text()}</p>
      <Show when={canAsk()}>
        <p class="mt-2 text-fg-muted">{t(m.inviteProblemAskInviter, { inviter: props.inviter })}</p>
      </Show>
      <div class="mt-6">
        <Show
          when={problem().kind === "failed"}
          fallback={
            <Button variant="primary" href="/sign-in">
              {t(m.signinSubmit)}
            </Button>
          }
        >
          <Button variant="primary" onClick={props.onRetry}>
            {t(messages.errorFallbackRetry)}
          </Button>
        </Show>
      </div>
    </>
  );
}

function SetupForm(props: {
  preview: Preview | null;
  options: Options;
  token: string;
  inviterName: string;
  onProblem: (p: Problem) => void;
  onDone: () => Promise<void>;
}): JSX.Element {
  const { t, locale } = useI18n();
  const api = useApi();

  const names = new Intl.DisplayNames([locale()], { type: "currency" });
  const currencyOptions = (): ComboboxOption[] =>
    props.options.currencies.map((code) => ({
      value: code,
      label: `${code} – ${names.of(code) ?? code}`,
    }));
  const zones = timeZoneOptions(Temporal.Now.instant());
  const zoneOptions: ComboboxOption[] = zones.map((z) => ({ value: z.id, label: z.label }));
  const languageNames = new Intl.DisplayNames([locale()], { type: "language" });
  const languageOptions = (): ComboboxOption[] =>
    props.options.locales.map((l) => ({ value: l, label: languageNames.of(l) ?? l }));

  const [name, setName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [currency, setCurrency] = createSignal<string | null>(
    defaultCurrencyFor(locale(), props.options.currencies),
  );
  const device = deviceTimeZone();
  const [zone, setZone] = createSignal<string | null>(
    zones.some((z) => z.id === device) ? device : null,
  );
  const [language, setLanguage] = createSignal<string | null>(
    props.options.locales.includes(locale()) ? locale() : "en",
  );
  const [errors, setErrors] = createSignal<Record<string, string | undefined>>({});
  const [summary, setSummary] = createSignal<{ fieldId?: string; text: string }[]>([]);
  const [busy, setBusy] = createSignal(false);

  const setError = (field: string, message: string | undefined): void => {
    setErrors((e) => ({ ...e, [field]: message }));
  };

  const nameProblem = (): string | undefined => {
    const n = length(name().trim());
    if (n === 0) return t(m.profileNameRequired);
    return n > MAX_NAME ? t(m.profileNameTooLong) : undefined;
  };
  const passwordProblem = (): string | undefined => {
    const n = length(password());
    if (n < MIN_PASSWORD) return t(m.passwordTooShort);
    return n > MAX_PASSWORD ? t(m.passwordTooLong) : undefined;
  };
  const currencyProblem = (): string | undefined =>
    currency() === null ? t(m.profileCurrencyRequired) : undefined;
  const zoneProblem = (): string | undefined =>
    zone() === null ? t(m.profileTimeZoneRequired) : undefined;

  const FIELD_IDS = {
    name: "setup-name",
    password: "setup-password",
    currency: "setup-currency",
    timeZone: "setup-timezone",
  } as const;

  const validate = (): boolean => {
    const found = {
      name: nameProblem(),
      password: passwordProblem(),
      currency: currencyProblem(),
      timeZone: zoneProblem(),
    };
    setErrors(found);
    const first = (Object.keys(found) as (keyof typeof found)[]).find(
      (k) => found[k] !== undefined,
    );
    if (first !== undefined) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const passwordMessage = (reason: string): string | undefined => {
    switch (reason) {
      case "too_short":
        return t(m.passwordTooShort);
      case "too_long":
        return t(m.passwordTooLong);
      case "common":
        return t(m.passwordCommon);
      case "contains_email":
        return t(m.passwordContainsEmail);
      default:
        return undefined;
    }
  };

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    setSummary([]);
    if (busy() || !validate()) return;
    setBusy(true);
    try {
      await api.invitations.accept({
        token: props.token,
        displayName: name().trim(),
        locale: language() ?? "en",
        timeZone: zone() ?? device,
        baseCurrency: currency() ?? "USD",
        method: { kind: "password", password: password() },
        tokenDelivery: "cookie",
      });
      await props.onDone();
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const handleFailure = (err: unknown): void => {
    const error = toAppError(err);
    if (error.kind === "defined") {
      if (error.key === "PASSWORD_TOO_WEAK") {
        const reason = (error.data as { reason?: unknown } | undefined)?.reason;
        const message = typeof reason === "string" ? passwordMessage(reason) : undefined;
        if (message !== undefined) {
          setError("password", message);
          document.getElementById(FIELD_IDS.password)?.focus();
          return;
        }
      }
      if (error.key === "VALIDATION_FAILED") {
        const issues = (error.data as { issues?: { path: (string | number)[] }[] } | undefined)
          ?.issues;
        const fieldFor: Record<string, [string, () => string | undefined]> = {
          displayName: ["name", () => t(m.profileNameRequired)],
          baseCurrency: ["currency", () => t(m.profileCurrencyRequired)],
          timeZone: ["timeZone", () => t(m.profileTimeZoneRequired)],
        };
        let focused = false;
        for (const issue of issues ?? []) {
          const mapped = fieldFor[String(issue.path[0])];
          if (mapped === undefined) continue;
          setError(mapped[0], mapped[1]());
          if (!focused) {
            document.getElementById(FIELD_IDS[mapped[0] as keyof typeof FIELD_IDS])?.focus();
            focused = true;
          }
        }
        if (focused) return;
      }
      if (error.key === "USER_CAP_REACHED") {
        setSummary([{ text: t(m.inviteFull, { inviter: props.inviterName }) }]);
        return;
      }
      if (
        error.key === "INVITATION_INVALID" ||
        error.key === "INVITATION_EXPIRED" ||
        error.key === "INVITATION_REVOKED" ||
        error.key === "INVITATION_USED"
      ) {
        props.onProblem(problemOf(err));
        return;
      }
    }
    const { descriptor, values } = identityErrorMessage(error, "create");
    setSummary([{ text: t(descriptor, values) }]);
  };

  return (
    <form class="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(m.setupTitle)}
      </h1>
      <Show when={props.preview}>
        {(p) => (
          <p class="text-fg-muted">
            <bdi dir="ltr">{p().email}</bdi>
          </p>
        )}
      </Show>
      <FormErrorSummary messages={summary()} />
      <TextField
        id={FIELD_IDS.name}
        label={t(m.setupName)}
        value={name()}
        autocomplete="name"
        onInput={(v) => {
          setName(v);
          if (errors().name !== undefined) setError("name", nameProblem());
        }}
        onBlur={() => {
          if (name() !== "") setError("name", nameProblem());
        }}
        error={errors().name}
      />
      <PasswordField
        id={FIELD_IDS.password}
        label={t(m.setupPassword)}
        hint={t(m.setupPasswordHint)}
        autocomplete="new-password"
        value={password()}
        onInput={(v) => {
          setPassword(v);
          if (errors().password !== undefined) setError("password", passwordProblem());
        }}
        onBlur={() => {
          if (password() !== "") setError("password", passwordProblem());
        }}
        error={errors().password}
      />
      <ComboboxField
        id={FIELD_IDS.currency}
        label={t(m.setupCurrency)}
        hint={t(m.setupCurrencyHint)}
        options={currencyOptions()}
        value={currency()}
        onChange={(v) => {
          setCurrency(v);
          setError("currency", undefined);
        }}
        error={errors().currency}
      />
      <ComboboxField
        id={FIELD_IDS.timeZone}
        label={t(m.setupTimeZone)}
        options={zoneOptions}
        value={zone()}
        onChange={(v) => {
          setZone(v);
          setError("timeZone", undefined);
        }}
        error={errors().timeZone}
      />
      <ComboboxField
        id="setup-language"
        label={t(m.setupLanguage)}
        options={languageOptions()}
        value={language()}
        onChange={setLanguage}
      />
      <p class="text-sm text-fg-muted">
        <a href="/privacy">{t(m.setupPrivacy)}</a>
      </p>
      <Button variant="primary" type="submit" fullWidth busy={busy()}>
        {t(m.setupSubmit)}
      </Button>
    </form>
  );
}
