// TP-4.52 (A-112), web: F-165's SETUP_TTL_MS mirrors the server's TOTP_SETUP_TTL (15 min). The server
// and Android halves pin the same value, so a change to one fails until all three move.
// Read through the module namespace, so a missing export fails this test, not the type check.
import { describe, expect, it } from "vitest";
import * as setupPage from "../../src/identity/settings/TwoStepSetupPage.js";

describe("TP-4.52: the client setup TTL (web)", () => {
  it("TP-4.52: SETUP_TTL_MS = 900000 (15 min)", () => {
    expect((setupPage as Record<string, unknown>).SETUP_TTL_MS).toBe(900_000);
  });
});
