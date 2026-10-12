// F-115: the sealed-column registry. Modules register their sealed columns at container build
// (A-26); the platform registers none.
import { TOKEN } from "../observability/safeFields.js";

export interface SealedColumn {
  table: string;
  idColumn: string;
  column: string;
  purpose: string;
  provider: "capture" | "api";
}

export interface SealedColumnRegistry {
  register(c: SealedColumn): void;
  all(): readonly SealedColumn[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function createSealedColumnRegistry(): SealedColumnRegistry {
  const columns: SealedColumn[] = [];
  return {
    register(c) {
      for (const id of [c.table, c.idColumn, c.column]) {
        if (!IDENTIFIER.test(id)) throw new TypeError(`invalid sealed-column identifier: ${id}`);
      }
      if (!TOKEN.test(c.purpose)) throw new TypeError("invalid sealed-column purpose");
      if (columns.some((x) => x.table === c.table && x.column === c.column)) {
        throw new TypeError(`duplicate sealed column: ${c.table}.${c.column}`);
      }
      columns.push({ ...c });
    },
    all: () => [...columns],
  };
}
