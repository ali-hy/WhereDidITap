// F-162: the header: the wordmark, and the account menu while signed in.
import { Show, type JSX } from "solid-js";
import { Wordmark } from "../../ui/Wordmark.js";
import { useSession } from "../session/SessionProvider.js";
import { AccountMenu } from "./AccountMenu.js";

export function AppHeader(): JSX.Element {
  const session = useSession();
  return (
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex min-h-14 max-w-[40rem] items-center justify-between px-4 min-[600px]:px-6">
        <Wordmark {...(session.status() === "signed_in" ? { href: "/" } : {})} />
        <Show when={session.status() === "signed_in"}>
          <AccountMenu />
        </Show>
      </div>
    </header>
  );
}
