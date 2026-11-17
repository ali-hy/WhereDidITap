// F-162: the account menu in the header. The trigger shows the initials and is named "Account".
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { useNavigate } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { toAppError } from "../../api/errors.js";
import { useI18n } from "../../i18n/useI18n.js";
import { showToast } from "../../ui/Toaster.js";
import { identityErrorMessage } from "../errorMessages.js";
import { identityMessages as m } from "../messages.js";
import { useSession } from "../session/SessionProvider.js";

/** The first letters of the first two words of the name. */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toLocaleUpperCase() || "?";
}

const ITEM =
  "flex min-h-11 cursor-pointer items-center rounded-control px-3 text-fg outline-none data-[highlighted]:bg-accent-tint data-[highlighted]:text-on-accent-tint";

export function AccountMenu(): JSX.Element {
  const { t } = useI18n();
  const session = useSession();
  const navigate = useNavigate();

  const signOut = async (): Promise<void> => {
    try {
      await session.signOut();
    } catch (e) {
      const { descriptor, values } = identityErrorMessage(toAppError(e), "read");
      showToast({ tone: "error", message: t(descriptor, values) });
    }
  };

  return (
    <DropdownMenu placement="bottom-end" modal={false}>
      <DropdownMenu.Trigger
        aria-label={t(m.menuAccount)}
        class="inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-sm font-semibold text-fg"
      >
        <span aria-hidden="true" dir="auto">
          {initialsOf(session.me()?.displayName ?? "")}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-10 mt-1 min-w-48 rounded-card border border-line bg-surface-raised p-1 shadow-overlay">
          <DropdownMenu.Item class={ITEM} onSelect={() => void navigate({ to: "/settings" })}>
            {t(m.menuSettings)}
          </DropdownMenu.Item>
          <DropdownMenu.Item class={ITEM} onSelect={() => void signOut()}>
            {t(m.menuSignOut)}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
