// F-152: provides the session store to components and switches the language to the user's.
import { createContext, createEffect, on, useContext, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import type { SessionStore } from "./sessionStore.js";

const SessionContext = createContext<SessionStore>();

export function SessionProvider(props: {
  store: SessionStore;
  children: JSX.Element;
}): JSX.Element {
  const { setLocale } = useI18n();
  createEffect(
    on(
      () => props.store.me()?.locale,
      (locale) => {
        if (locale !== undefined) void setLocale(locale);
      },
    ),
  );
  return <SessionContext.Provider value={props.store}>{props.children}</SessionContext.Provider>;
}

export function useSession(): SessionStore {
  const store = useContext(SessionContext);
  if (store === undefined) throw new Error("useSession needs a SessionProvider");
  return store;
}
