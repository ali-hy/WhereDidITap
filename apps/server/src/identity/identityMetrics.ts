// F-6: identity's own counters, registered through P-F-41's createMetrics (LD-7).
import type { Metrics } from "../platform/observability/metrics.js";

type Counter = { add(n: number, labels: Record<string, string>): void };

export interface IdentityMetrics {
  signIns: Counter;
  refreshes: Counter;
  refreshReuse: Counter;
  twoStep: Counter;
  emails: Counter;
  exports: Counter;
  erasures: Counter;
}

export function registerIdentityMetrics(m: Metrics): IdentityMetrics {
  return {
    signIns: m.counter("auth_sign_in_total", {
      description: "Sign-in and sign-up attempts by method and outcome.",
      labels: ["method", "error_key"],
    }),
    refreshes: m.counter("auth_refresh_total", {
      description: "Session refreshes by outcome.",
      labels: ["error_key"],
    }),
    refreshReuse: m.counter("auth_refresh_reuse_total", {
      description: "Refresh tokens presented after they were used.",
      labels: [],
    }),
    twoStep: m.counter("auth_two_step_total", {
      description: "Two-step verifications by method and outcome.",
      labels: ["method", "error_key"],
    }),
    emails: m.counter("identity_emails_total", {
      description: "Identity emails by outcome.",
      labels: ["error_key"],
    }),
    exports: m.counter("identity_exports_total", {
      description: "Data exports by outcome.",
      labels: ["error_key"],
    }),
    erasures: m.counter("identity_erasures_total", {
      description: "Account erasures by outcome.",
      labels: ["error_key"],
    }),
  };
}
