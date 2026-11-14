// F-1 constants (identity LLD §4.1, §3.1). Extra cases TP-0.41x: F-1 has no test-plan row, and
// TP-0.11 and later slices rely on these exact values.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { Temporal } from "@budmon/shared";
import { describe, expect, it } from "vitest";
import * as C from "../../../src/identity/constants.js";

const RELATIVE_TO = Temporal.ZonedDateTime.from("2026-01-01T00:00:00[UTC]");
const seconds = (d: unknown): number => {
  expect(d).toBeInstanceOf(Temporal.Duration);
  return (d as Temporal.Duration).total({ unit: "seconds", relativeTo: RELATIVE_TO });
};
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

describe("TP-0.41x: F-1's constants", () => {
  it.each([
    ["ACCESS_TTL", 15 * MIN],
    ["REFRESH_IDLE_TTL", 30 * DAY],
    ["REFRESH_RACE_WINDOW", 60],
    ["REFRESH_PRUNE_AGE", 90 * DAY],
    ["TWO_STEP_CHALLENGE_TTL", 5 * MIN],
    ["CONFIRM_VALIDITY", 10 * MIN],
    ["GOOGLE_FLOW_TTL", 10 * MIN],
    ["HANDOFF_TTL", 2 * MIN],
    ["SIGNUP_TICKET_TTL", 30 * MIN],
    ["GOOGLE_CONFIRM_MAX_AGE", 5 * MIN],
    ["RESET_TTL", 30 * MIN],
    ["INVITATION_TTL", 7 * 24 * HOUR],
    ["TOTP_SETUP_TTL", 15 * MIN],
    ["DELETION_GRACE", 7 * 24 * HOUR],
    ["EXPORT_TTL", 7 * DAY],
    ["KNOWN_DEVICE_TTL", 365 * DAY],
    ["SECURITY_EVENT_RETENTION", 90 * DAY],
    ["ENDED_SESSION_RETENTION", 30 * DAY],
    ["ENDED_INVITATION_RETENTION", 90 * DAY],
    ["EXPORT_ROW_RETENTION", 30 * DAY],
    ["RECENT_ACCEPT_WINDOW", 10 * MIN],
  ])("TP-0.41x: %s is a Temporal.Duration of %d seconds", (name, expected) => {
    expect(seconds((C as Record<string, unknown>)[name])).toBe(expected);
  });

  it.each([
    ["MAX_LIVE_SESSIONS", 20],
    ["TWO_STEP_MAX_ATTEMPTS", 5],
    ["RESET_MAX_OUTSTANDING", 3],
    ["RESET_MAX_FAILED_CODES", 5],
    ["INVITATION_RESENDS_PER_DAY", 3],
    ["DEFAULT_INVITE_ALLOWANCE", 3],
    ["DEFAULT_USER_CAP", 90],
    ["RECOVERY_CODE_COUNT", 10],
    ["EXPORTS_PER_DAY", 3],
    ["EXPORT_MAX_BYTES", 200 * 1024 * 1024],
    ["MAX_KNOWN_DEVICES", 20],
    ["ARGON2_MAX_CONCURRENCY", 4],
  ])("TP-0.41x: %s is %d", (name, expected) => {
    expect((C as Record<string, unknown>)[name]).toBe(expected);
  });

  it("TP-0.41x: there is no absolute session lifetime (HLD D-2)", () => {
    expect((C as Record<string, unknown>)["SESSION_ABSOLUTE_TTL"]).toBeUndefined();
  });

  it('TP-0.41x (A-23, A-26): APP_NAME is the brand, exactly "wDit"', () => {
    expect((C as Record<string, unknown>)["APP_NAME"]).toBe("wDit");
  });

  it("TP-0.41x: the locales are LD-10's", () => {
    expect([...C.SUPPORTED_LOCALES]).toEqual(["en"]);
    expect([...C.PSEUDO_LOCALES]).toEqual(["en-XA", "ar-XB"]);
  });

  it("TP-0.41x: SECURITY_EVENT_KINDS is §3.1's list", () => {
    expect([...C.SECURITY_EVENT_KINDS].sort()).toEqual(
      [
        "sign_in_succeeded",
        "sign_in_failed",
        "sign_up",
        "two_step_failed_sign_in",
        "two_step_enabled",
        "two_step_disabled",
        "two_step_reset_by_owner",
        "authenticator_replaced",
        "recovery_codes_regenerated",
        "recovery_code_used",
        "password_changed",
        "password_added",
        "password_reset",
        "google_linked_auto",
        "google_linked",
        "google_unlinked",
        "session_revoked",
        "refresh_reuse_detected",
        "deletion_requested",
        "deletion_cancelled",
        "deletion_by_owner",
        "deletion_cancelled_by_owner",
        "banned",
        "export_requested",
      ].sort(),
    );
  });
});
