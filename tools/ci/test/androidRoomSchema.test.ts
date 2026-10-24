// TP-13.19 (A-486): the committed Room schema export matches F-254's outbox table. Static, no SDK:
// it reads apps/android/app/schemas/com.budmon.app.core.db.BudmonDatabase/1.json, which CI's
// android job produces and compares with the build's own export (TP-0.34).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(
  ROOT,
  "apps/android/app/schemas/com.budmon.app.core.db.BudmonDatabase/1.json",
);

interface Field {
  columnName?: unknown;
  affinity?: unknown;
  notNull?: unknown;
}
interface Entity {
  tableName?: unknown;
  fields?: Field[];
  primaryKey?: unknown;
  indices?: { unique?: unknown; columnNames?: unknown }[];
}
interface Schema {
  formatVersion?: unknown;
  database?: { version?: unknown; identityHash?: unknown; entities?: Entity[] };
}

const schema = (): Schema => JSON.parse(readFileSync(FILE, "utf8")) as Schema;
const outbox = (): Entity | undefined => schema().database?.entities?.[0];

const COLUMNS: [string, string][] = [
  ["id", "INTEGER"],
  ["idempotencyKey", "TEXT"],
  ["method", "TEXT"],
  ["path", "TEXT"],
  ["body", "BLOB"],
  ["contentType", "TEXT"],
  ["createdAtEpochMs", "INTEGER"],
  ["status", "TEXT"],
  ["lastErrorKey", "TEXT"],
  ["attempts", "INTEGER"],
];

describe("TP-13.19: the committed Room schema matches F-254 (A-486)", () => {
  it("TP-13.19: 1.json exists, formatVersion 1, database version 1, a 32-hex identityHash", () => {
    expect(existsSync(FILE), FILE).toBe(true);
    const s = schema();

    expect(s.formatVersion).toBe(1);
    expect(s.database?.version).toBe(1);
    expect(s.database?.identityHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("TP-13.19: exactly one entity, outbox", () => {
    const entities = schema().database?.entities ?? [];

    expect(entities.map((e) => e.tableName)).toEqual(["outbox"]);
  });

  it("TP-13.19: outbox's columns, affinities and nullability", () => {
    const fields = outbox()?.fields ?? [];

    expect(fields.map((f) => f.columnName)).toEqual(COLUMNS.map(([c]) => c));
    expect(fields.map((f) => [f.columnName, f.affinity])).toEqual(COLUMNS);
    expect(fields.filter((f) => f.notNull !== true).map((f) => f.columnName)).toEqual([
      "lastErrorKey",
    ]);
    expect(fields.find((f) => f.columnName === "lastErrorKey")?.notNull).toBe(false);
  });

  it("TP-13.19: primary key id, auto-generated; one unique index on idempotencyKey", () => {
    const e = outbox();

    expect(e?.primaryKey).toEqual({ autoGenerate: true, columnNames: ["id"] });
    expect(e?.indices?.map((i) => ({ unique: i.unique, columnNames: i.columnNames }))).toEqual([
      { unique: true, columnNames: ["idempotencyKey"] },
    ]);
  });
});
