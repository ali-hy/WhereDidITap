// F-162 (S-1): the header, the wordmark only. The account menu arrives with S-3.
import type { JSX } from "solid-js";
import { Wordmark } from "../../ui/Wordmark.js";
import { useSession } from "../session/SessionProvider.js";

export function AppHeader(): JSX.Element {
  const session = useSession();
  return (
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex min-h-14 max-w-[40rem] items-center px-4 min-[600px]:px-6">
        <Wordmark {...(session.status() === "signed_in" ? { href: "/" } : {})} />
      </div>
    </header>
  );
}
