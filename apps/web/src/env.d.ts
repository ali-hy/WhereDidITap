// The Vite variables the web app reads (dot access, so Vite replaces them statically).
interface ImportMetaEnv {
  readonly VITE_PSEUDO_LOCALES?: string;
  readonly VITE_FIXTURES?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_BUILD_NUMBER: string;
}
