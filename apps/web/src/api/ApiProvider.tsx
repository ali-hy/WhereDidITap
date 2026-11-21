// Gives components the API client main.tsx created.
import { createContext, useContext, type JSX } from "solid-js";
import type { ApiClient } from "./client.js";

const ApiContext = createContext<ApiClient>();

export function ApiProvider(props: { api: ApiClient; children: JSX.Element }): JSX.Element {
  return <ApiContext.Provider value={props.api}>{props.children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (api === undefined) throw new Error("useApi needs an ApiProvider");
  return api;
}
