// F-153: the route guards (TanStack Router `beforeLoad`).
import { redirect } from "@tanstack/solid-router";
import type { SessionStore } from "../session/sessionStore.js";

interface GuardArgs {
  context: { session: SessionStore };
  location: { pathname: string };
}

/** A same-site path of URL-safe characters; anything else is `/`. */
export function safeNext(value: unknown): string {
  return typeof value === "string" &&
    /^\/[A-Za-z0-9/_-]{0,200}$/.test(value) &&
    !value.startsWith("//")
    ? value
    : "/";
}

export async function requireSignedIn({ context, location }: GuardArgs): Promise<void> {
  const { session } = context;
  // Try again re-runs the guard, so an unavailable store probes again first.
  if (session.status() === "unavailable") await session.retry();
  const state = await session.ready();
  if (state === "signed_out") {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({
      to: "/sign-in",
      search: {
        next: safeNext(location.pathname),
        ...(session.endedDuringBoot() ? { reason: "ended" } : {}),
      },
    });
  }
  // The original error, so the root error component shows the platform's "unavailable" page.
  if (state === "unavailable") throw session.error();
}

export async function requireSignedOut({ context }: GuardArgs): Promise<void> {
  const state = await context.session.ready();
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
  if (state === "signed_in") throw redirect({ to: "/" });
}
