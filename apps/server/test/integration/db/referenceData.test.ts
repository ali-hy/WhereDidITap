// F-21 loadReferenceData. TP-2.14 (I).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReferenceData } from "../../../src/platform/db/referenceData.js";
import { SchemaStepError } from "../../../src/platform/db/schemaStep.js";
import type { Database } from "../../../src/platform/db/types.js";
import { referenceData } from "../../support/platform.js";
import { createTestDatabase, type TestDatabase } from "../../support/testDatabase.js";

let testDb: TestDatabase;
let migrator: Database;

beforeAll(async () => {
  testDb = await createTestDatabase("budmon_migrator");
  migrator = testDb.database;
});

afterAll(async () => {
  await testDb.drop();
});

async function currency(code: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await migrator.handle.executeSql(
    "SELECT code, name, minor_units, is_active FROM currencies WHERE code = $1",
    [code],
  );
  return rows[0];
}

describe("TP-2.14 (I): loadReferenceData", () => {
  it("TP-2.14: on an empty currencies table, every entry is upserted", async () => {
    await migrator.handle.executeSql("TRUNCATE exchange_rates, currencies");
    const data = referenceData();

    const result = await loadReferenceData(migrator.handle, data);

    expect(result).toEqual({ upserted: data.currencies.length });
    const { rows } = await migrator.handle.executeSql("SELECT count(*)::int AS n FROM currencies");
    expect(rows[0]?.["n"]).toBe(data.currencies.length);
  });

  it("TP-2.14: a changed name is updated (one upsert)", async () => {
    const data = referenceData();
    const changed = {
      currencies: data.currencies.map((c) =>
        c.code === "EGP" ? { ...c, name: "Egyptian Pound (test)" } : c,
      ),
    };

    const result = await loadReferenceData(migrator.handle, changed);

    expect(result).toEqual({ upserted: 1 });
    expect(await currency("EGP")).toMatchObject({ name: "Egyptian Pound (test)", minor_units: 2 });
  });

  it("TP-2.14: a changed minorUnits throws minor_units_changed and changes nothing", async () => {
    const before = await currency("EGP");
    const data = referenceData();
    const changed = {
      currencies: data.currencies.map((c) => {
        if (c.code === "EGP") return { ...c, minorUnits: 3 };
        // Renames before and after EGP in either iteration order: neither may survive.
        if (c.code === "AED") return { ...c, name: "UAE Dirham (renamed)" };
        if (c.code === "USD") return { ...c, name: "US Dollar (renamed)" };
        return c;
      }),
    };

    let caught: unknown;
    try {
      await loadReferenceData(migrator.handle, changed);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SchemaStepError);
    expect(caught).toMatchObject({ code: "minor_units_changed", subject: "EGP" });
    expect(await currency("EGP")).toEqual(before);
    expect((await currency("USD"))?.["name"]).not.toBe("US Dollar (renamed)");
    expect((await currency("AED"))?.["name"]).not.toBe("UAE Dirham (renamed)");
  });

  it("TP-2.50x: a second identical load upserts nothing and never deletes", async () => {
    const data = referenceData();
    await loadReferenceData(migrator.handle, data);
    await migrator.handle.executeSql(
      "INSERT INTO currencies (code, name, minor_units) VALUES ('ZZZ', 'Not in the file', 2)",
    );

    const result = await loadReferenceData(migrator.handle, data);

    expect(result).toEqual({ upserted: 0 });
    expect(await currency("ZZZ")).toBeDefined();
  });

  it("TP-2.50x: an inactive flag change is upserted", async () => {
    const data = referenceData();
    const changed = {
      currencies: data.currencies.map((c) => (c.code === "SAR" ? { ...c, active: false } : c)),
    };

    const result = await loadReferenceData(migrator.handle, changed);

    expect(result).toEqual({ upserted: 1 });
    expect((await currency("SAR"))?.["is_active"]).toBe(false);
  });
});
