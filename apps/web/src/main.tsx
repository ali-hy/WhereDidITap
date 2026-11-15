// F-200: the application entry.
import { resolveLocale } from "@budmon/shared";
import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { render } from "solid-js/web";
import { markClientUpdateRequired } from "./api/clientUpdate.js";
import { createApiClient } from "./api/client.js";
import { createQueryClient } from "./api/queryClient.js";
import { ApiProvider } from "./api/ApiProvider.js";
import { I18nProvider, supportedLocales } from "./i18n/I18nProvider.js";
import "./styles/app.css";
import { initWebSentry } from "./observability/sentry.js";
import { SessionProvider } from "./identity/session/SessionProvider.js";
import { createSessionStore, type SessionStore } from "./identity/session/sessionStore.js";
import { createAppRouter } from "./router.js";
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

// 2.
const queryClient = createQueryClient();
export const api = createApiClient({
  buildNumber,
  onClientUpdateRequired: markClientUpdateRequired,
});

// 3. The user's preference comes later from identity; for now the browser's language.
const initialLocale = resolveLocale(navigator.language, supportedLocales(), "en");

// 4.
// The store and the router refer to each other, so the router is bound late.
const navigation: { go: (href: string) => void } = { go: () => {} };
const session: SessionStore = createSessionStore({
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
              <RouterProvider router={router} />
            </SessionProvider>
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
