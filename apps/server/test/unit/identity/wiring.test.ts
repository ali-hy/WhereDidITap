// Identity's wiring into the platform's composition points (identity LLD §1.1, A-26, A-202). TP-0.32's
// static (U) half with S-4's expectations; the container half is in
// test/integration/identity/wiring.test.ts.
import { contract } from "@budmon/contract";
import { describe, expect, it } from "vitest";
import { tableGrants } from "../../../src/platform/db/grants.js";
import { seeders } from "../../../src/platform/db/seed.js";
import { appRouter } from "../../../src/platform/http/appRouter.js";
import { PUBLIC_PROCEDURES } from "../../../src/platform/http/procedures.js";
import {
  buildJobRegistry,
  platformJobDefinitions,
} from "../../../src/platform/queue/appRegistry.js";
import { identityGrants } from "../../../src/identity/identityGrants.js";
import { identityJobs } from "../../../src/identity/identityJobs.js";
import { identityRouter } from "../../../src/identity/identityRouter.js";

const PLATFORM_TABLES = [
  "currencies",
  "exchange_rates",
  "idempotency_records",
  "rate_limit_counters",
];

describe("TP-0.32 (U): the wiring points, as of S-4", () => {
  it("TP-0.32 (S-1): appRouter and the contract have meta plus identity's auth, me and invitations", () => {
    expect(Object.keys(appRouter).sort()).toEqual(["auth", "invitations", "me", "meta"]);
    expect(Object.keys(contract).sort()).toEqual(["auth", "invitations", "me", "meta"]);
  });

  it("TP-0.32 (S-4): identityRouter has S-1's, S-3's and S-4's procedures", () => {
    const procedures = Object.entries(identityRouter as Record<string, object>)
      .flatMap(([group, router]) => Object.keys(router).map((name) => `${group}.${name}`))
      .sort();

    expect(procedures).toEqual(
      [
        "auth.signUpOptions",
        "invitations.accept",
        "invitations.preview",
        "me.get",
        // S-3
        "auth.methods",
        "auth.refresh",
        "auth.signIn",
        "auth.signOut",
        "me.confirm",
        "me.listSessions",
        "me.revokeOtherSessions",
        "me.revokeSession",
        // S-4
        "auth.verifyTwoStep",
        "me.acknowledgeRecoveryCodes",
        "me.regenerateRecoveryCodes",
        "me.twoStepDisable",
        "me.twoStepEnable",
        "me.twoStepReplaceConfirm",
        "me.twoStepReplaceStart",
        "me.twoStepSetup",
      ].sort(),
    );
  });

  it("TP-0.32 (S-4): PUBLIC_PROCEDURES is meta.clientConfig plus §5.1's S-1, S-3 and S-4 entries", () => {
    expect([...PUBLIC_PROCEDURES].sort()).toEqual(
      [
        "auth.signUpOptions",
        "invitations.accept",
        "invitations.preview",
        "meta.clientConfig",
        // S-3
        "auth.methods",
        "auth.refresh",
        "auth.signIn",
        // S-4
        "auth.verifyTwoStep",
      ].sort(),
    );
  });

  it("TP-0.32 (S-3): buildJobRegistry() has the platform's jobs plus identity.email-send and identity.purge", () => {
    const names = buildJobRegistry()
      .all()
      .map((d) => d.name);

    expect(names.sort()).toEqual(
      [
        ...platformJobDefinitions.map((d) => d.name),
        "identity.email-send",
        "identity.purge",
      ].sort(),
    );
    expect(buildJobRegistry().get("identity.email-send")).toBe(identityJobs.emailSend);
    expect(buildJobRegistry().get("identity.purge")).toBe(identityJobs.purge);
  });

  it("TP-0.32: tableGrants has the platform's 4 tables and identity's 15", () => {
    expect(Object.keys(tableGrants).sort()).toEqual(
      [...PLATFORM_TABLES, ...Object.keys(identityGrants)].sort(),
    );
    expect(Object.keys(identityGrants)).toHaveLength(15);
  });

  it("TP-0.32: seeders are platform.fx-rates, then identity.dev-owner", () => {
    expect(seeders.map((s) => s.name)).toEqual(["platform.fx-rates", "identity.dev-owner"]);
  });
});
