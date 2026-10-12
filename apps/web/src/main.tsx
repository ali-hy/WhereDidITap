// F-200: the application entry.
import { resolveLocale } from "@budmon/shared";
import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { render } from "solid-js/web";
import { markClientUpdateRequired } from "./api/clientUpdate.js";
import { createApiClient } from "./api/client.js";
import { createQueryClient } from "./api/queryClient.js";
import { I18nProvider, supportedLocales } from "./i18n/I18nProvider.js";
import "./index.css";
import { initWebSentry } from "./observability/sentry.js";
import { createAppRouter } from "./router.js";
import { OfflineBanner } from "./ui/OfflineBanner.js";
import { Toaster } from "./ui/Toaster.js";
import { UpdateNotifier } from "./ui/UpdateNotifier.js";

const buildNumber = Number.parseInt(import.meta.env.VITE_BUILD_NUMBER, 10) || 0;

// 1.
initWebSentry({
  ...(import.meta.env.VITE_SENTRY_DSN === undefined
    ? {}
    : { dsn: import.meta.env.VITE_SENTRY_DSN }),
  release: `web@${String(buildNumber)}`,
  environment: import.meta.env.MODE,
});

// 2.
const queryClient = createQueryClient();
export const api = createApiClient({
  buildNumber,
  onClientUpdateRequired: markClientUpdateRequired,
});

// 3. The user's preference comes later from identity; for now the browser's language.
const initialLocale = resolveLocale(navigator.language, supportedLocales(), "en");

// 4.
const router = await createAppRouter();
const root = document.getElementById("root");
if (root !== null) {
  render(
    () => (
      <I18nProvider initialLocale={initialLocale}>
        <QueryClientProvider client={queryClient}>
          <OfflineBanner />
          <RouterProvider router={router} />
          <UpdateNotifier buildNumber={buildNumber} />
          <Toaster />
          <div id="live-polite" class="sr-only" aria-live="polite" aria-atomic="true" />
          <div id="live-assertive" class="sr-only" aria-live="assertive" aria-atomic="true" />
        </QueryClientProvider>
      </I18nProvider>
    ),
    root,
  );
}
