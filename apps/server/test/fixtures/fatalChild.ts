// Child process for TP-3.17 (b) (F-39, A-118, A-120): the api entry's fatal-handler set-up, then
// one fatal event carrying a canary. With SENTRY_DSN set (b1), state.reporter is F-34's Sentry
// reporter pointing at the test's envelope server; without it (b2), the startup no-op reporter.
// Usage: tsx fatalChild.ts unhandled|uncaught
import { CANARIES } from "@budmon/test-support";
import { installFatalHandlers, startupState } from "../../src/platform/observability/fatal.js";
import { initSentry } from "../../src/platform/observability/sentry.js";

const state = startupState("api", process.env);
const dsn = process.env["SENTRY_DSN"];
if (dsn !== undefined && dsn !== "") {
  state.reporter = initSentry({
    dsn,
    environment: "test",
    release: "v1.2.3",
    service: "api",
  });
}
installFatalHandlers(state);

const mode = process.argv[2];
if (mode === "unhandled") {
  void Promise.reject(new Error(CANARIES.message));
} else if (mode === "uncaught") {
  setTimeout(() => {
    throw new Error(CANARIES.payee);
  }, 10);
} else {
  process.exitCode = 64;
}
