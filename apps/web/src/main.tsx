// F-200: the application entry.
import "@budmon/contract/web";
import { resolveLocale } from "@budmon/shared";
import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { markClientUpdateRequired } from "./api/clientUpdate.js";
import { createApiClient } from "./api/client.js";
import { createQueryClient } from "./api/queryClient.js";
import { ApiProvider } from "./api/ApiProvider.js";
import { I18nProvider, supportedLocales } from "./i18n/I18nProvider.js";
import "./styles/app.css";
import { initWebSentry } from "./observability/sentry.js";
import { ConfirmItsYouDialog } from "./identity/components/ConfirmItsYou.js";
import { SessionProvider } from "./identity/session/SessionProvider.js";
import { createAuthedFetch } from "./identity/session/authedFetch.js";
import { refreshWebSession } from "./identity/session/refresh.js";
import { createSessionStore, type SessionStore } from "./identity/session/sessionStore.js";
import { BootScreen, createAppRouter, routerBooted } from "./router.js";
import { AppBanners } from "./ui/AppBanners.js";
import { Toaster } from "./ui/Toaster.js";
import { initTheme } from "./ui/theme.js";

const buildNumber = Number.parseInt(import.meta.env.VITE_BUILD_NUMBER, 10) || 0;

// 1.
initWebSentry({
  ...(import.meta.env.VITE_SENTRY_DSN === undefined
    ? {}
    : { dsn: import.meta.env.VITE_SENTRY_DSN }),
  release: `web@${String(buildNumber)}`,
  environment: import.meta.env.MODE,
});

// 1b. The mode was set before first paint; this follows the system while the setting is system.
initTheme();

// 2. The store, the router and the authed fetch refer to each other, so they are bound late.
const queryClient = createQueryClient();
// Assigned after the client that calls it; see 4.
// eslint-disable-next-line prefer-const -- the client's closure needs the name before the store exists
let session!: SessionStore;
const refreshClient = createApiClient({
  buildNumber,
  onClientUpdateRequired: markClientUpdateRequired,
});
export const api = createApiClient({
  buildNumber,
  onClientUpdateRequired: markClientUpdateRequired,
  fetch: createAuthedFetch(window.fetch.bind(window), {
    refresh: () => refreshWebSession(refreshClient),
    onSessionEnded: () => {
      session.sessionEnded(location.pathname);
    },
  }),
});

// 3. The user's preference comes later from identity; for now the browser's language.
const initialLocale = resolveLocale(navigator.language, supportedLocales(), "en");

// 4.
const navigation: { go: (href: string) => void } = { go: () => {} };
session = createSessionStore({
  api,
  queryClient,
  navigate: (href) => {
    navigation.go(href);
  },
});
const router = await createAppRouter({ session });
navigation.go = (href) => void router.navigate({ href });
// Started, not awaited: the page renders its boot state while the guards wait.
void session.boot();
const root = document.getElementById("root");
if (root !== null) {
  render(
    () => (
      <I18nProvider initialLocale={initialLocale}>
        <QueryClientProvider client={queryClient}>
          <ApiProvider api={api}>
            <AppBanners buildNumber={buildNumber} />
            <SessionProvider store={session}>
              <Show when={!routerBooted()}>
                <BootScreen />
              </Show>
              <RouterProvider router={router} />
            </SessionProvider>
            <ConfirmItsYouDialog />
            <Toaster />
            <div id="live-polite" class="sr-only" aria-live="polite" aria-atomic="true" />
            <div id="live-assertive" class="sr-only" aria-live="assertive" aria-atomic="true" />
          </ApiProvider>
        </QueryClientProvider>
      </I18nProvider>
    ),
    root,
  );
}
