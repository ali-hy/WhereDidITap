// F-22 ports and F-34 createIdentityModule (identity LLD §4.1). TP-0.20, plus extra cases TP-0.20x.
// The container wiring (TP-0.32, TP-0.37) is in test/integration/identity/wiring.test.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { fixedClock, uuidv7Generator } from "@budmon/shared";
import { describe, expect, it, vi } from "vitest";
import { createSealedColumnRegistry } from "../../../src/platform/crypto/sealedColumns.js";
import type { Database } from "../../../src/platform/db/types.js";
import { buildJobRegistry } from "../../../src/platform/queue/appRegistry.js";
import {
  defaultPorts,
  type ErasureParticipant,
  type ExportParticipant,
} from "../../../src/identity/ports.js";
import { createIdentityModule, type IdentityBase } from "../../../src/identity/identityModule.js";
import type { PasswordHasher } from "../../../src/identity/passwordHasher.js";
import { observed, testApiConfig } from "../../support/api.js";

function base(): IdentityBase {
  const obs = observed();
  return {
    config: testApiConfig(),
    logger: obs.overrides.logger,
    clock: fixedClock("2026-11-02T10:00:00Z"),
    ids: uuidv7Generator,
    database: {
      handle: { executeSql: vi.fn(), inTransaction: false },
      pool: {},
      close: vi.fn(),
    } as unknown as Database,
    metrics: obs.metrics,
    reporter: obs.reporter,
    registry: buildJobRegistry(),
    queue: { enqueue: vi.fn() },
    sealedColumns: createSealedColumnRegistry(),
  };
}

const hasher: PasswordHasher = {
  hash: () => Promise.resolve("$argon2id$x"),
  verify: () => Promise.resolve(false),
  needsRehash: () => false,
};

const erasure = (module: string, order: number): ErasureParticipant => ({
  module,
  order,
  erase: () => Promise.resolve(),
});
const exporter = (module: string, order: number): ExportParticipant => ({
  module,
  order,
  collect: () => Promise.resolve([]),
});

describe("TP-0.20: ports at composition", () => {
  it("TP-0.20: erasure participants with a duplicate module name → TypeError", () => {
    expect(() =>
      createIdentityModule(base(), {
        hasher,
        commonPasswords: new Set(),
        ports: { erasureParticipants: [erasure("accounts", 1), erasure("accounts", 2)] },
      }),
    ).toThrow(TypeError);
  });

  it("TP-0.20: with distinct modules, the lists are sorted by order", () => {
    const m = createIdentityModule(base(), {
      hasher,
      commonPasswords: new Set(),
      ports: {
        erasureParticipants: [
          erasure("ledger", 20),
          erasure("accounts", 10),
          erasure("sources", 15),
        ],
        exportParticipants: [exporter("ledger", 2), exporter("accounts", 1)],
      },
    });

    expect(m.ports.erasureParticipants.map((p) => p.module)).toEqual([
      "accounts",
      "sources",
      "ledger",
    ]);
    expect(m.ports.exportParticipants.map((p) => p.module)).toEqual(["accounts", "ledger"]);
  });
});

describe("TP-0.20x: defaults and S-0's module", () => {
  it("TP-0.20x: defaultPorts() has empty lists, a policy allowing everyone and a null context line", async () => {
    const ports = defaultPorts();
    const h = base().database.handle;

    expect(ports.deletionPrechecks).toEqual([]);
    expect(ports.erasureParticipants).toEqual([]);
    expect(ports.exportParticipants).toEqual([]);
    await expect(ports.invitePolicy.canSendInvitations(h, "u")).resolves.toBe(true);
    await expect(ports.invitationContext.contextLine(h, "i", "en")).resolves.toBeNull();
  });

  it("TP-0.20x: duplicate export participants → TypeError", () => {
    expect(() =>
      createIdentityModule(base(), {
        hasher,
        commonPasswords: new Set(),
        ports: { exportParticipants: [exporter("a", 1), exporter("a", 2)] },
      }),
    ).toThrow(TypeError);
  });

  it("TP-0.20x: S-0's module: erasureHandler and onGeneralWorkerStarted are null, routes empty without testRoutes", () => {
    const m = createIdentityModule(base(), { hasher, commonPasswords: new Set() });

    expect(m.erasureHandler).toBeNull();
    expect(m.onGeneralWorkerStarted).toBeNull();
    expect(m.routes).toEqual([]);
    expect(typeof m.authHook.authenticate).toBe("function");
  });

  it("TP-0.20x: with testRoutes, routes holds one callback that calls it with the app and the deps", () => {
    const testRoutes = vi.fn();
    const m = createIdentityModule(base(), { hasher, commonPasswords: new Set(), testRoutes });
    const app = {} as never;

    expect(m.routes).toHaveLength(1);
    m.routes[0]?.(app);

    expect(testRoutes).toHaveBeenCalledWith(app, m.deps);
  });

  it("TP-0.20x: the deps carry the overrides and the base's members; no sender without config.email", () => {
    const b = base();
    const passwords = new Set(["x"]);
    const m = createIdentityModule(b, { hasher, commonPasswords: passwords });

    expect(m.deps.hasher).toBe(hasher);
    expect(m.deps.commonPasswords()).toBe(passwords);
    expect(m.deps.clock).toBe(b.clock);
    expect(m.deps.database).toBe(b.database);
    expect(m.deps.platformMetrics).toBe(b.metrics);
    expect(m.deps.registry).toBe(b.registry);
    expect(m.deps.queue).toBe(b.queue);
    expect(m.deps.sender).toBeNull();
    expect(m.deps.events).toBe(m.events);
    expect(m.deps.ports).toBe(m.ports);
  });
});
