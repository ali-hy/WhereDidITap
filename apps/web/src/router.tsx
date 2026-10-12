// F-216: the router (TanStack Router, code-based).
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type AnyRoute,
  type ErrorComponentProps,
} from "@tanstack/solid-router";
import { createSignal, type JSX } from "solid-js";
import { toAppError } from "./api/errors.js";
import { HomePlaceholder } from "./pages/HomePlaceholder.js";
import { NotFound } from "./pages/NotFound.js";
import { announce } from "./ui/a11y.js";
import { ErrorFallback } from "./ui/ErrorFallback.js";

function RootLayout(): JSX.Element {
  return (
    <>
      <header />
      <main id="main" class="mx-auto max-w-[40rem] p-4">
        <Outlet />
      </main>
    </>
  );
}

export async function createAppRouter() {
  // A-397: whether the last Try again failed. It lives here, above the error component, which the
  // router remounts after invalidate(); cleared on success and on a pathname change.
  const [retryFailed, setRetryFailed] = createSignal(false);
  // Assigned below; the error component only runs once the router exists.
  let retry: () => Promise<void> = () => Promise.resolve();
  const rootRoute = createRootRoute({
    component: RootLayout,
    errorComponent: (props: ErrorComponentProps) => {
      const error = toAppError(props.error);
      return (
        <ErrorFallback
          error={error}
          {...(error.requestId === undefined ? {} : { requestId: error.requestId })}
          stillFailing={retryFailed()}
          onRetry={() => retry()}
        />
      );
    },
    notFoundComponent: NotFound,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePlaceholder,
  });

  const children: AnyRoute[] = [indexRoute];
  // A-332: fixtures are only reachable in fixture builds; a normal build folds this away.
  if (import.meta.env.VITE_FIXTURES === "1") {
    const { createFixtureRoutes } = await import("./fixtures/routes.js");
    children.push(...createFixtureRoutes(rootRoute));
  }

  const router = createRouter({ routeTree: rootRoute.addChildren(children) });
  // A-397: Try again re-runs the loaders and rejects while any match is still in error.
  retry = async () => {
    await router.invalidate();
    if (router.state.matches.some((m) => m.status === "error")) {
      setRetryFailed(true);
      throw new Error("still failing");
    }
    setRetryFailed(false);
  };

  // A-333, A-402: after a client-side navigation to another pathname (never the first load, and
  // never for search, hash or invalidate()), focus the new page's h1 and announce its text.
  let pathname: string | undefined;
  router.subscribe("onResolved", (event) => {
    const next = event.toLocation.pathname;
    const previous = pathname;
    pathname = next;
    if (previous === undefined || previous === next) return;
    setRetryFailed(false);
    setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>("main h1");
      if (h1 === null) return;
      h1.focus();
      announce(h1.textContent);
    }, 0);
  });
  return router;
}
