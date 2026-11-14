// Identity's wiring into the platform's composition points (identity LLD §1.1, A-26, A-202). TP-0.32's
// static (U) half with S-0's expectations; the container half is in
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

describe("TP-0.32 (U): S-0's wiring points", () => {
  it("TP-0.32: appRouter and the contract have only meta (no identity procedures in S-0)", () => {
    expect(Object.keys(appRouter)).toEqual(["meta"]);
    expect(Object.keys(contract)).toEqual(["meta"]);
  });

  it("TP-0.32: identityRouter is {} in S-0", () => {
    expect(identityRouter).toEqual({});
  });

  it("TP-0.32: PUBLIC_PROCEDURES is only meta.clientConfig", () => {
    expect([...PUBLIC_PROCEDURES]).toEqual(["meta.clientConfig"]);
  });

  it("TP-0.32: buildJobRegistry() has the platform's jobs plus identity.email-send", () => {
    const names = buildJobRegistry()
      .all()
      .map((d) => d.name);

    expect(names.sort()).toEqual(
      [...platformJobDefinitions.map((d) => d.name), "identity.email-send"].sort(),
    );
    expect(buildJobRegistry().get("identity.email-send")).toBe(identityJobs.emailSend);
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
