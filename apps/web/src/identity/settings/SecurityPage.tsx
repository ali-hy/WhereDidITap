// F-164: Sign-in & security. S-3 has the sessions section (J-10); later slices add the rest.
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { useApi } from "../../api/ApiProvider.js";
import { toAppError } from "../../api/errors.js";
import { messages } from "../../i18n/messages.js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { Skeleton } from "../../ui/Skeleton.js";
import { showToast } from "../../ui/Toaster.js";
import { setDocumentTitle } from "../../ui/a11y.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";

const MINUTE = 60_000;
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60 * MINUTE],
  ["hour", 60 * MINUTE],
  ["minute", MINUTE],
];

export function SecurityPage(): JSX.Element {
  const { t, locale } = useI18n();
  const api = useApi();
  const queryClient = useQueryClient();
  createEffect(() => {
    setDocumentTitle(t(m.settingsSecurity), t);
  });

  // One request: "Try again" is the retry.
  const sessions = createQuery(() => ({
    queryKey: ["sessions"],
    queryFn: () => api.me.listSessions(),
    retry: false,
    staleTime: 0,
  }));
  const [busyId, setBusyId] = createSignal<string | null>(null);

  const fail = (e: unknown): void => {
    const { descriptor, values } = identityErrorMessage(toAppError(e), "mutation");
    showToast({ tone: "error", message: t(descriptor, values) });
  };

  const revoke = async (sessionId: string): Promise<void> => {
    setBusyId(sessionId);
    try {
      await api.me.revokeSession({ sessionId });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async (): Promise<void> => {
    setBusyId("others");
    try {
      const { revoked } = await api.me.revokeOtherSessions({});
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast({ tone: "success", message: t(m.sessionsSignedOutOthers, { n: revoked }) });
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  };

  const dateOf = (iso: string): string =>
    new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(iso));
  const lastActive = (iso: string): string => {
    const diff = new Date(iso).getTime() - Date.now();
    if (Math.abs(diff) < MINUTE) return t(m.sessionsActiveNow);
    const format = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    for (const [unit, size] of UNITS) {
      if (Math.abs(diff) >= size) {
        return t(m.sessionsLastActive, { relative: format.format(Math.trunc(diff / size), unit) });
      }
    }
    return t(m.sessionsActiveNow);
  };
  const loadError = (): string => {
    const { descriptor, values } = identityErrorMessage(toAppError(sessions.error), "read");
    return t(descriptor, values);
  };

  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        {t(m.settingsSecurity)}
      </h1>
      <section class="mt-6" aria-busy={sessions.isPending ? "true" : undefined}>
        <h2 class="text-lg font-semibold text-fg">{t(m.sessionsTitle)}</h2>
        <Switch>
          <Match when={sessions.isPending}>
            <div class="mt-4">
              <Skeleton rows={3} shape="row" />
            </div>
          </Match>
          <Match when={sessions.isError}>
            <p class="mt-4 text-fg">{loadError()}</p>
            <div class="mt-4">
              <Button variant="secondary" onClick={() => void sessions.refetch()}>
                {t(messages.errorFallbackRetry)}
              </Button>
            </div>
          </Match>
          <Match when={sessions.data}>
            {(data) => (
              <>
                <ul class="mt-4 flex flex-col divide-y divide-line">
                  <For each={data().items}>
                    {(item) => (
                      <li class="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div class="min-w-0 [overflow-wrap:anywhere]">
                          <p class="font-medium text-fg">{item.deviceLabel}</p>
                          <Show when={item.current}>
                            <p class="text-sm text-fg">{t(m.sessionsThisDevice)}</p>
                          </Show>
                          <p class="text-sm text-fg-muted">
                            {t(m.sessionsSignedIn, { date: dateOf(item.createdAt) })}
                          </p>
                          <p class="text-sm text-fg-muted">{lastActive(item.lastUsedAt)}</p>
                        </div>
                        <Show when={!item.current}>
                          <div>
                            <Button
                              variant="secondary"
                              size="compact"
                              busy={busyId() === item.id}
                              onClick={() => void revoke(item.id)}
                            >
                              {t(m.sessionsSignOut)}
                            </Button>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={data().items.length > 1}>
                  <div class="mt-4" data-button-row>
                    <Button
                      variant="secondary"
                      busy={busyId() === "others"}
                      onClick={() => void revokeOthers()}
                    >
                      {t(m.sessionsSignOutOthers)}
                    </Button>
                  </div>
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </section>
    </>
  );
}
