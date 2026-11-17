// F-33 job definitions (identity LLD §4.1, LD-13). TP-0.21 with S-3's expectations (S-3 registers
// identity.purge), plus extra cases TP-0.21x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import type { WorkerContainer } from "../../../src/platform/container.js";
import { buildJobRegistry } from "../../../src/platform/queue/appRegistry.js";
import { defineJob, type JobDefinition } from "../../../src/platform/queue/jobs.js";
import { assertPayloadSafe } from "../../../src/platform/queue/payloadSafety.js";
import {
  identityHandlers,
  identityJobDefinitions,
  identityJobs,
} from "../../../src/identity/identityJobs.js";

const REF = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a40";
const fakeWorker = { identity: { deps: {} } } as unknown as WorkerContainer;

/** The fields F-33's table fixes. */
function shape(def: JobDefinition<unknown>) {
  return {
    name: def.name,
    role: def.role,
    policy: def.policy,
    retryLimit: def.retryLimit,
    retryDelaySeconds: def.retryDelaySeconds,
    retryBackoff: def.retryBackoff,
    expireInSeconds: def.expireInSeconds,
    cron: def.cron,
  };
}

describe("TP-0.21: identity's job definitions (as of S-3)", () => {
  it("TP-0.21: every definition passes P-F-70 (re-defining it gives the same definition)", () => {
    for (const def of identityJobDefinitions) {
      const { name, role, payload, ...rest } = def;
      expect(defineJob({ name, role, payload, ...rest })).toEqual(def);
    }
  });

  it("TP-0.21 (S-3): exactly identity.email-send and identity.purge are registered, with F-33's policies, retries and cron", () => {
    const byName = new Map(identityJobDefinitions.map((d) => [d.name, d]));

    expect([...byName.keys()].sort()).toEqual(["identity.email-send", "identity.purge"]);
    expect(shape(byName.get("identity.email-send") as JobDefinition<unknown>)).toEqual({
      name: "identity.email-send",
      role: "general",
      policy: "standard",
      retryLimit: 5,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 900,
      cron: undefined,
    });
    // "default" in F-33's table: P-F-70's retry delay (30 s, backoff) and expiry (900 s).
    expect(shape(byName.get("identity.purge") as JobDefinition<unknown>)).toEqual({
      name: "identity.purge",
      role: "general",
      policy: "singleton",
      retryLimit: 2,
      retryDelaySeconds: 30,
      retryBackoff: true,
      expireInSeconds: 900,
      cron: "5 * * * *",
    });
  });

  it("TP-0.21: identityHandlers(c) has exactly the definitions' names", () => {
    const names = identityHandlers(fakeWorker).map(([name]) => name);

    expect(names.sort()).toEqual(identityJobDefinitions.map((d) => d.name).sort());
    expect(new Set(names).size).toBe(names.length);
    for (const [, handler] of identityHandlers(fakeWorker)) expect(typeof handler).toBe("function");
  });

  it("TP-0.21: buildJobRegistry() holds each identity definition itself", () => {
    const registry = buildJobRegistry();

    for (const def of identityJobDefinitions) expect(registry.get(def.name)).toBe(def);
  });
});

describe("TP-0.21x: every identityJobs member is defined from S-0 (F-33's table)", () => {
  it("TP-0.21x: emailSend and purge are the registered definitions themselves", () => {
    expect(identityJobDefinitions).toContain(identityJobs.emailSend);
    expect(identityJobDefinitions).toContain(identityJobs.purge);
  });

  it("TP-0.21x: exportBuild, erasureSweep and eraseUser have F-33's values but aren't registered yet", () => {
    expect(shape(identityJobs.exportBuild)).toMatchObject({
      name: "identity.export-build",
      role: "general",
      policy: "standard",
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 1800,
    });
    expect(shape(identityJobs.erasureSweep)).toMatchObject({
      name: "identity.erasure-sweep",
      role: "general",
      policy: "stately",
      retryLimit: 2,
      cron: "*/15 * * * *",
    });
    expect(shape(identityJobs.eraseUser)).toMatchObject({
      name: "identity.erase-user",
      role: "general",
      policy: "stately",
      retryLimit: 10,
      retryDelaySeconds: 60,
      retryBackoff: true,
    });
    const registry = buildJobRegistry();
    for (const name of ["identity.export-build", "identity.erasure-sweep", "identity.erase-user"]) {
      expect(registry.get(name)).toBeUndefined();
    }
  });

  it("TP-0.21x: the email-send payload accepts { kind, refId } and an optional recipient", () => {
    const p = identityJobs.emailSend.payload;

    expect(p.safeParse({ kind: "invitation", refId: REF }).success).toBe(true);
    expect(
      p.safeParse({ kind: "invitation_cap_failed", refId: REF, recipient: "owner" }).success,
    ).toBe(true);
    expect(
      p.safeParse({ kind: "invitation_cap_failed", refId: REF, recipient: "inviter" }).success,
    ).toBe(true);
  });

  it.each([
    ["an unknown kind", { kind: "spam", refId: REF }],
    ["a refId that isn't a UUID", { kind: "invitation", refId: "x" }],
    ["an unknown recipient", { kind: "invitation_cap_failed", refId: REF, recipient: "admin" }],
    ["no refId", { kind: "invitation" }],
  ])("TP-0.21x: the email-send payload refuses %s", (_label, payload) => {
    expect(identityJobs.emailSend.payload.safeParse(payload).success).toBe(false);
  });

  it("TP-0.21x: an email-send payload passes P-F-72's safety check", () => {
    expect(() => {
      assertPayloadSafe({ kind: "session_reuse_signed_out", refId: REF });
    }).not.toThrow();
  });

  it("TP-0.21x: the other payloads parse as F-33 states", () => {
    expect(identityJobs.purge.payload.safeParse({}).success).toBe(true);
    expect(identityJobs.exportBuild.payload.safeParse({ exportId: REF }).success).toBe(true);
    expect(identityJobs.erasureSweep.payload.safeParse({}).success).toBe(true);
    expect(identityJobs.eraseUser.payload.safeParse({ userId: REF, replay: false }).success).toBe(
      true,
    );
    expect(identityJobs.eraseUser.payload.safeParse({ userId: REF }).success).toBe(false);
  });
});
