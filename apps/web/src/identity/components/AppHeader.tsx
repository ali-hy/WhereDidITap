// F-162: the header: the wordmark, and the account menu while signed in.
import { Show, type JSX } from "solid-js";
import { Wordmark } from "../../ui/Wordmark.js";
import { useSession } from "../session/SessionProvider.js";
import { AccountMenu } from "./AccountMenu.js";

/**
 * On the home page itself the wordmark stays put and focuses the page's h1; elsewhere it goes home
 * through the router (the new page's h1 takes focus), or as a plain link when there is no router.
 */
function homeClick(event: MouseEvent, navigate: ((to: string) => void) | undefined): void {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (location.pathname === "/") {
    event.preventDefault();
    document.querySelector<HTMLElement>("main h1")?.focus();
  } else if (navigate !== undefined) {
    event.preventDefault();
    navigate("/");
  }
}

/** [width] is the Tailwind max-width class of the page's `main`, so the two line up. */
export function AppHeader(props: { width?: string; navigate?: (to: string) => void }): JSX.Element {
  const session = useSession();
  let header: HTMLElement | undefined;
  return (
    <header
      ref={(el) => {
        header = el;
      }}
      class="border-b border-line bg-surface"
    >
      <div
        class={`mx-auto flex min-h-14 ${props.width ?? "max-w-[40rem]"} items-center justify-between px-4 min-[600px]:px-6`}
      >
        <Wordmark
          {...(session.status() === "signed_in"
            ? {
                href: "/",
                onClick: (e: MouseEvent) => {
                  homeClick(e, props.navigate);
                },
              }
            : {})}
        />
        <Show when={session.status() === "signed_in"}>
          <AccountMenu mount={() => header} />
        </Show>
      </div>
    </header>
  );
}
