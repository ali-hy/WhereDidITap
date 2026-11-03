// Child process for TP-3.14 (b) and (c): initialises F-34's Sentry against the DSN in SENTRY_DSN,
// then lets one of TP-3.13's frame-shaped errors escape, uncaught or as an unhandled rejection.
// Its own handler flushes the reporter and exits 0, so the test reads only what Sentry sent.
// Usage: tsx sentryChild.ts uncaught|unhandled
import { CANARIES } from "@budmon/test-support";
import { initSentry } from "../../../src/platform/observability/sentry.js";

const mode = process.argv[2];
const dsn = process.env["SENTRY_DSN"];
const reporter = initSentry({
  ...(dsn === undefined ? {} : { dsn }),
  environment: "test",
  release: "v1.2.3",
  service: "api",
});

async function finish(): Promise<void> {
  await reporter.flush(2_000);
  process.exit(0);
}

process.on("uncaughtException", () => void finish());
process.on("unhandledRejection", () => void finish());

const err = new Error(`x\n    at ${CANARIES.payee} (/a.js:1:1)\n    at ${CANARIES.message}`);

if (mode === "uncaught") {
  setTimeout(() => {
    throw err;
  }, 10);
} else if (mode === "unhandled") {
  void Promise.reject(err);
} else {
  process.stderr.write(`unknown mode ${String(mode)}\n`);
  process.exit(64);
}
