// S-11b loaders (test-architect). The S-11b modules (F-201 to F-205, F-209 to F-214, F-217, F-218)
// and their dependencies load through plain imports of the real modules (N-8); the LLD's shapes
// declared here type the tests' own fakes and fixtures.
import type { JSX } from "solid-js";

// ---- F-202 ----
export type AppError =
  | { kind: "defined"; key: string; status: number; data: unknown }
  | { kind: "unavailable" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "unknown" };

// ---- F-203 ----
export interface MessageDescriptor {
  id: string;
  defaultMessage?: string;
}
export type Operation = "read" | "create" | "mutation";

// ---- Query client (the parts the tests touch) ----
export type QueryKey = readonly unknown[];
export interface QueryState {
  isInvalidated: boolean;
}
export interface QueryDefaults {
  retry?: unknown;
  retryDelay?: unknown;
  refetchOnWindowFocus?: unknown;
  staleTime?: unknown;
}
export interface QueryClient {
  getDefaultOptions(): { queries?: QueryDefaults; mutations?: QueryDefaults };
  fetchQuery(options: { queryKey: QueryKey; queryFn: () => Promise<unknown> }): Promise<unknown>;
  setQueryData(key: QueryKey, data: unknown): unknown;
  getQueryState(key: QueryKey): QueryState | undefined;
  clear(): void;
}
export interface MutationObserver {
  mutate: (variables?: unknown) => Promise<unknown>;
}
export interface SolidQuery {
  QueryClientProvider: (props: { client: QueryClient; children: JSX.Element }) => JSX.Element;
  MutationObserver: new (
    client: QueryClient,
    options: { mutationFn: (v: unknown) => Promise<unknown>; meta?: Record<string, unknown> },
  ) => MutationObserver;
}

// ---- F-205 ----
export interface CreateMutationResult<I> {
  mutateAsync: (input: I) => Promise<{ id: string; createdAt: string }>;
  /** Fire-and-forget (B-1's overlapping calls). */
  mutate: (input: I) => void;
}

// ---- F-213 ----
export interface Issue {
  code: string;
  path: readonly (string | number)[];
  message: string;
}
export interface FormField {
  id: string;
  label: string;
  setError: (m: string) => void;
}
export type Translate = (d: MessageDescriptor, v?: Record<string, unknown>) => string;

// ---- Modules ----
export interface ClientModule {
  createApiClient: (opts: {
    buildNumber: number;
    baseUrl?: string;
    fetch?: typeof fetch;
    onClientUpdateRequired?: () => void;
  }) => { meta: { clientConfig: () => Promise<unknown> } };
}
export interface ErrorsModule {
  toAppError: (err: unknown) => AppError;
}
export interface ErrorMessagesModule {
  messageForError: (
    e: AppError,
    operation: Operation,
  ) => { descriptor: MessageDescriptor; values?: Record<string, string | number> };
}
export interface QueryClientModule {
  createQueryClient: () => QueryClient;
}
export interface CreateMutationModule {
  createCreateMutation: <I>(opts: {
    mutationFn: (input: I, idempotencyKey: string) => Promise<{ id: string; createdAt: string }>;
    invalidate: readonly QueryKey[];
  }) => CreateMutationResult<I>;
}
export interface ErrorFallbackModule {
  ErrorFallback: (props: {
    error: AppError;
    requestId?: string;
    onRetry: () => Promise<void>;
  }) => JSX.Element;
}
export interface UpdateNotifierModule {
  UpdateNotifier: (props: {
    buildNumber: number;
    fetchVersion?: () => Promise<{ buildNumber: number }>;
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => () => void;
    /** A-325: defaults to api/clientUpdate.ts's clientUpdateRequired. */
    updateRequired?: () => boolean;
  }) => JSX.Element;
}
export interface ClientUpdateModule {
  clientUpdateRequired: () => boolean;
  markClientUpdateRequired: () => void;
}
export interface OfflineBannerModule {
  OfflineBanner: (props: Record<string, never>) => JSX.Element;
}
export interface ToasterModule {
  Toaster: (props: Record<string, never>) => JSX.Element;
  showToast: (t: {
    message: string;
    tone: "info" | "error" | "success";
    action?: { label: string; onClick: () => void };
    persistent?: boolean;
  }) => string;
  dismissToast: (id: string) => void;
}
export interface FormsModule {
  FieldError: (props: { id: string; message?: string | undefined }) => JSX.Element;
  FormErrorSummary: (props: {
    messages: readonly { fieldId?: string; text: string }[];
  }) => JSX.Element;
  applyServerIssues: (
    issues: readonly Issue[],
    fields: Readonly<Record<string, FormField>>,
    t: Translate,
  ) => { summary: { fieldId?: string; text: string }[] };
}
export interface RateLimitModule {
  createRateLimitGate: (now?: () => number) => {
    blockedFor: () => number;
    block: (retryAfterSeconds: number) => void;
  };
  RateLimitNotice: (props: { secondsLeft: number }) => JSX.Element;
}
export interface SentryModule {
  initWebSentry: (cfg: { dsn?: string; release: string; environment: string }) => void;
  scrubWebEvent: (e: Record<string, unknown>) => Record<string, unknown> | null;
}
export interface A11yModule {
  announce: (text: string, politeness?: "polite" | "assertive") => void;
}
export interface OrpcClientModule {
  ORPCError: new (
    code: string,
    options?: { defined?: boolean; status?: number; message?: string; data?: unknown },
  ) => Error;
}

// N-8: the modules exist now, so each loader is a plain import of the real module (typed by it).
export const loadClient = () => import("../../src/api/client.js");
export const loadErrors = () => import("../../src/api/errors.js");
export const loadErrorMessages = () => import("../../src/api/errorMessages.js");
export const loadQueryClient = () => import("../../src/api/queryClient.js");
export const loadCreateMutation = () => import("../../src/api/createMutation.js");
export const loadErrorFallback = () => import("../../src/ui/ErrorFallback.js");
export const loadUpdateNotifier = () => import("../../src/ui/UpdateNotifier.js");
export const loadOfflineBanner = () => import("../../src/ui/OfflineBanner.js");
export const loadToaster = () => import("../../src/ui/Toaster.js");
export const loadForms = () => import("../../src/ui/forms.js");
export const loadRateLimit = () => import("../../src/ui/RateLimitNotice.js");
export const loadSentry = () => import("../../src/observability/sentry.js");
export const loadA11y = () => import("../../src/ui/a11y.js");
export const loadClientUpdate = () => import("../../src/api/clientUpdate.js");
export const loadSolidQuery = () => import("@tanstack/solid-query");
export const loadOrpcClient = () => import("@orpc/client");

/** An oRPC defined error as the client decodes the server's envelope (§6). */
export async function definedError(code: string, status: number, data?: unknown): Promise<Error> {
  const { ORPCError } = await loadOrpcClient();
  return new ORPCError(code, { defined: true, status, message: code, data });
}

/** Removes F-206's isolation marks (U+2068, U+2069) so texts compare as plain strings. */
export function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/[⁨⁩]/g, "");
}
