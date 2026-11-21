// F-216: the router (TanStack Router, code-based).
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
  type AnyRoute,
  type ErrorComponentProps,
} from "@tanstack/solid-router";
import { createSignal, type JSX } from "solid-js";
import { AppHeader } from "./identity/components/AppHeader.js";
import { HomeFirstRun } from "./identity/components/HomeFirstRun.js";
import { InvitePage } from "./identity/pages/InvitePage.js";
import { PrivacyNoticePage } from "./identity/pages/PrivacyNoticePage.js";
import { SignInPage } from "./identity/pages/SignInPage.js";
import { TwoStepPage } from "./identity/pages/TwoStepPage.js";
import { TwoStepSetupPage } from "./identity/settings/TwoStepSetupPage.js";
import { SecurityPage } from "./identity/settings/SecurityPage.js";
import { SettingsHome } from "./identity/settings/SettingsHome.js";
import { SettingsLayout } from "./identity/settings/SettingsLayout.js";
import { requireSignedIn, requireSignedOut, safeNext } from "./identity/routes/guards.js";
import { useSession } from "./identity/session/SessionProvider.js";
import type { SessionStore } from "./identity/session/sessionStore.js";
import { toAppError } from "./api/errors.js";
import { NotFound } from "./pages/NotFound.js";
import { announce } from "./ui/a11y.js";
import { ErrorFallback } from "./ui/ErrorFallback.js";

/** The layout's frame; the error fallback renders inside it too (§4.18, Q-D2). */
function Shell(props: { children: JSX.Element }): JSX.Element {
  const session = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Settings has room for two columns from 960 px.
  const width = () => (pathname().startsWith("/settings") ? "max-w-[72rem]" : "max-w-[40rem]");
  return (
    <>
      <AppHeader width={width()} navigate={(to) => void navigate({ to })} />
      <main
        id="main"
        aria-busy={session.status() === "loading" ? "true" : undefined}
        class={`mx-auto ${width()} px-4 pt-8 pb-8 min-[600px]:px-6`}
      >
        {props.children}
      </main>
    </>
  );
}

/** True once the router has resolved its first location. */
const [routerBooted, setRouterBooted] = createSignal(false);
export { routerBooted };

/** The first load's frame: the header and an empty busy `main` until the guards settle. */
export function BootScreen(): JSX.Element {
  return (
    <>
      <AppHeader />
      <main
        id="main"
        aria-busy="true"
        class="mx-auto max-w-[40rem] px-4 pt-8 pb-8 min-[600px]:px-6"
      />
    </>
  );
}

function RootLayout(): JSX.Element {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

const HEADING_WAIT_MS = 2000;
const SETTLE_MS = 3000;

/**
 * A page that re-renders after arriving replaces its h1 and drops focus to the body; focus follows
 * the new h1. Watches for a few seconds, and stops at the first key press or pointer press.
 */
function keepFocus(focused: HTMLElement): void {
  let current = focused;
  const follow = (): void => {
    if (current.isConnected || document.activeElement !== document.body) return;
    const next = document.querySelector<HTMLElement>("main h1");
    if (next === null) return;
    next.focus();
    current = next;
  };
  const observer = new MutationObserver(follow);
  observer.observe(document.body, { childList: true, subtree: true });
  const stop = (): void => {
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener("keydown", stop, true);
    document.removeEventListener("pointerdown", stop, true);
  };
  const timer = setTimeout(stop, SETTLE_MS);
  document.addEventListener("keydown", stop, true);
  document.addEventListener("pointerdown", stop, true);
}

/**
 * A-542: focuses and announces the first `main h1` that differs from the one shown before the
 * navigation. Checks on the next task, then each animation frame; after 2 s takes any `main h1`.
 */
function focusNewHeading(previous: Element | null): void {
  const started = performance.now();
  const attempt = (final: boolean): boolean => {
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (h1 === null || (h1 === previous && !final)) return false;
    h1.focus();
    announce(h1.textContent);
    keepFocus(h1);
    return true;
  };
  const frame = (): void => {
    if (attempt(false)) return;
    if (performance.now() - started >= HEADING_WAIT_MS) {
      attempt(true);
      return;
    }
    requestAnimationFrame(frame);
  };
  setTimeout(() => {
    if (!attempt(false)) requestAnimationFrame(frame);
  }, 0);
}

export async function createAppRouter(opts: { session: SessionStore }) {
  // A-397: whether the last Try again failed. It lives here, above the error component, which the
  // router remounts after invalidate(); cleared on success and on a pathname change.
  const [retryFailed, setRetryFailed] = createSignal(false);
  // Assigned below; the error component only runs once the router exists.
  let retry: () => Promise<void> = () => Promise.resolve();
  const rootRoute = createRootRouteWithContext<{ session: SessionStore }>()({
    component: RootLayout,
    errorComponent: (props: ErrorComponentProps) => {
      const error = toAppError(props.error);
      // The root's errorComponent replaces RootLayout, so it brings the layout's frame with it.
      return (
        <Shell>
          <ErrorFallback
            error={error}
            {...(error.requestId === undefined ? {} : { requestId: error.requestId })}
            stillFailing={retryFailed()}
            onRetry={() => retry()}
          />
        </Shell>
      );
    },
    notFoundComponent: NotFound,
  });
  // Pathless groups: they only carry the guards.
  const signedIn = createRoute({
    getParentRoute: () => rootRoute,
    id: "signedIn",
    beforeLoad: requireSignedIn,
  });
  const signedOut = createRoute({
    getParentRoute: () => rootRoute,
    id: "signedOut",
    beforeLoad: requireSignedOut,
  });
  const indexRoute = createRoute({
    getParentRoute: () => signedIn,
    path: "/",
    component: HomeFirstRun,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => signedIn,
    path: "/settings",
    component: SettingsLayout,
  });
  const settingsHomeRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/",
    component: SettingsHome,
  });
  const securityRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/security",
    validateSearch: (search: Record<string, unknown>): { newCodes?: 1 } =>
      search.newCodes === 1 || search.newCodes === "1" ? { newCodes: 1 } : {},
    component: SecurityPage,
  });
  const twoStepSetupRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/security/two-step",
    validateSearch: (search: Record<string, unknown>): { mode?: "replace" } =>
      search.mode === "replace" ? { mode: "replace" } : {},
    component: TwoStepSetupPage,
  });
  const signInRoute = createRoute({
    getParentRoute: () => signedOut,
    path: "/sign-in",
    validateSearch: (search: Record<string, unknown>): { next?: string; reason?: string } => ({
      ...(typeof search.next === "string" ? { next: safeNext(search.next) } : {}),
      ...(typeof search.reason === "string" && /^[a-z_]{1,32}$/.test(search.reason)
        ? { reason: search.reason }
        : {}),
    }),
    component: SignInPage,
  });
  const twoStepRoute = createRoute({
    getParentRoute: () => signedOut,
    path: "/sign-in/two-step",
    validateSearch: (search: Record<string, unknown>): { next?: string } =>
      typeof search.next === "string" ? { next: safeNext(search.next) } : {},
    component: TwoStepPage,
  });
  const inviteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/invite",
    component: InvitePage,
  });
  const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: PrivacyNoticePage,
  });

  const children: AnyRoute[] = [
    signedIn.addChildren([
      indexRoute,
      settingsRoute.addChildren([settingsHomeRoute, securityRoute, twoStepSetupRoute]),
    ]),
    signedOut.addChildren([signInRoute, twoStepRoute]),
    inviteRoute,
    privacyRoute,
  ];
  // A-332: fixtures are only reachable in fixture builds; a normal build folds this away.
  if (import.meta.env.VITE_FIXTURES === "1") {
    const { createFixtureRoutes } = await import("./fixtures/routes.js");
    children.push(...createFixtureRoutes(rootRoute));
  }

  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    context: { session: opts.session },
  });
  // A-397: Try again re-runs the loaders and rejects while any match is still in error.
  retry = async () => {
    await router.invalidate();
    const failing = router.state.matches.some((m) => m.status === "error");
    // A-456: after the remount, focus Try again (still failing) or the page's h1 (recovered).
    setTimeout(() => {
      if (failing) {
        document.querySelector<HTMLElement>("main [data-fallback-retry]")?.focus();
        return;
      }
      const h1 = document.querySelector<HTMLElement>("main h1");
      if (h1 === null) return;
      h1.focus();
      announce(h1.textContent);
    }, 0);
    if (failing) {
      setRetryFailed(true);
      throw new Error("still failing");
    }
    setRetryFailed(false);
  };

  // A-333, A-402: after a client-side navigation to another pathname (never the first load, and
  // never for search, hash or invalidate()), focus the new page's h1 and announce its text.
  let pathname: string | undefined;
  let headingBefore: Element | null = null;
  router.subscribe("onBeforeNavigate", () => {
    headingBefore = document.querySelector("main h1");
  });
  router.subscribe("onResolved", (event) => {
    setRouterBooted(true);
    const next = event.toLocation.pathname;
    const previous = pathname;
    pathname = next;
    if (previous === undefined || previous === next) return;
    setRetryFailed(false);
    focusNewHeading(headingBefore);
  });
  return router;
}
