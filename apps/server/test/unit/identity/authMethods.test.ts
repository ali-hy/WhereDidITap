// F-58 authMethods (identity LLD §4.4). TP-3.24, plus extra cases TP-3.24x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import type { Config } from "../../../src/platform/config/schema.js";
import { Secret } from "../../../src/platform/observability/redaction.js";
import { authMethods } from "../../../src/identity/signInService.js";

type GoogleSignIn = NonNullable<Config["api"]>["googleSignIn"];

const TAILNET = "https://laptop.x.ts.net";

function google(callbackOrigin: string, appOrigins: string[]): GoogleSignIn {
  return {
    clientId: "test.apps.googleusercontent.com",
    clientSecret: Secret.of("secret"),
    androidClientIds: [],
    callbackOrigin: new URL(callbackOrigin),
    appOrigins: appOrigins.map((o) => new URL(o)),
  };
}

describe("TP-3.24: authMethods", () => {
  it("TP-3.24: Google not configured → unavailable", () => {
    expect(authMethods(undefined, TAILNET)).toEqual({ password: true, google: "unavailable" });
  });

  it("TP-3.24: an origin that isn't in appOrigins → unavailable", () => {
    const cfg = google("https://laptop.x.ts.net", [TAILNET]);

    expect(authMethods(cfg, "https://other.x.ts.net")).toEqual({
      password: true,
      google: "unavailable",
    });
  });

  it("TP-3.24: callback http://localhost:8080 with the tailnet origin → this_computer_only", () => {
    const cfg = google("http://localhost:8080", ["http://localhost:8080", TAILNET]);

    expect(authMethods(cfg, TAILNET)).toEqual({ password: true, google: "this_computer_only" });
  });

  it("TP-3.24: callback http://localhost:8080 with that same origin → available", () => {
    const cfg = google("http://localhost:8080", ["http://localhost:8080", TAILNET]);

    expect(authMethods(cfg, "http://localhost:8080")).toEqual({
      password: true,
      google: "available",
    });
  });

  it("TP-3.24: an https callback → available from any listed origin", () => {
    const cfg = google("https://laptop.x.ts.net", ["http://localhost:8080", TAILNET]);

    expect(authMethods(cfg, TAILNET)).toEqual({ password: true, google: "available" });
    expect(authMethods(cfg, "http://localhost:8080")).toEqual({
      password: true,
      google: "available",
    });
  });
});

describe("TP-3.24x: authMethods edge cases", () => {
  it("TP-3.24x: no Origin header (null) → unavailable", () => {
    const cfg = google("https://laptop.x.ts.net", [TAILNET]);

    expect(authMethods(cfg, null)).toEqual({ password: true, google: "unavailable" });
  });

  it("TP-3.24x: origins compare as serialised origins (a listed https origin with an explicit :443 matches)", () => {
    const cfg = google("https://laptop.x.ts.net", ["https://laptop.x.ts.net:443"]);

    expect(authMethods(cfg, TAILNET)).toEqual({ password: true, google: "available" });
  });

  it("TP-3.24x: a localhost callback without a port, with another listed origin → this_computer_only", () => {
    const cfg = google("http://localhost", ["http://localhost", TAILNET]);

    expect(authMethods(cfg, TAILNET)).toEqual({ password: true, google: "this_computer_only" });
  });
});
