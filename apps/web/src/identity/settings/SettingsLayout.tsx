// F-162: the settings frame: a section nav at the inline start from 960 px, stacked below.
import { Link, Outlet } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { identityMessages as m } from "../messages.js";

const LINK = "flex min-h-11 items-center rounded-control px-3 text-fg no-underline";

export function SettingsLayout(): JSX.Element {
  const { t } = useI18n();
  return (
    <div class="grid grid-cols-1 gap-6 min-[60rem]:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label={t(m.settingsTitle)}>
        <ul class="flex flex-col gap-1">
          <li>
            <Link
              to="/settings/security"
              class={LINK}
              activeProps={{ class: `${LINK} bg-accent-tint text-on-accent-tint` }}
            >
              {t(m.settingsSecurity)}
            </Link>
          </li>
        </ul>
      </nav>
      <div class="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
