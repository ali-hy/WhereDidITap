// F-146: the erasure log, one object per erased user, read back from the key names.
import { Temporal, canonicalJson } from "@budmon/shared";
import type { ObjectStore } from "./objectStore.js";

export interface ErasureRecord {
  userId: string;
  erasedAt: Temporal.Instant;
}

export interface ErasureLog {
  append(r: ErasureRecord): Promise<void>;
  listSince(since: Temporal.Instant): Promise<ErasureRecord[]>;
}

export type ErasureHandler = (userId: string) => Promise<void>;

const RECORD_KEY = /^records\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_([0-9a-f-]{36})\.json$/;

/** `YYYYMMDDTHHMMSSZ` (UTC, whole seconds). */
function compactUtc(instant: Temporal.Instant): string {
  const t = instant.toZonedDateTimeISO("UTC");
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    String(t.year).padStart(4, "0") +
    two(t.month) +
    two(t.day) +
    "T" +
    two(t.hour) +
    two(t.minute) +
    two(t.second) +
    "Z"
  );
}

function recordOf(key: string): ErasureRecord | null {
  const m = RECORD_KEY.exec(key);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, userId = ""] = m;
  try {
    return {
      userId,
      erasedAt: Temporal.Instant.from(
        `${y ?? ""}-${mo ?? ""}-${d ?? ""}T${h ?? ""}:${mi ?? ""}:${s ?? ""}Z`,
      ),
    };
  } catch {
    return null;
  }
}

export function createErasureLog(store: ObjectStore): ErasureLog {
  return {
    async append(r) {
      await store.put(
        "erasure-log",
        `records/${compactUtc(r.erasedAt)}_${r.userId}.json`,
        Buffer.from(canonicalJson({ userId: r.userId, erasedAt: r.erasedAt.toString() })),
        "application/json",
      );
    },
    async listSince(since) {
      // A-305: keys hold whole seconds, so `since` is truncated to its second; replay is
      // idempotent, so up to one extra second of records is harmless.
      const from = Temporal.Instant.fromEpochMilliseconds(
        Math.floor(since.epochMilliseconds / 1000) * 1000,
      );
      const records: ErasureRecord[] = [];
      for await (const entry of store.list("erasure-log", "records/")) {
        const record = recordOf(entry.key);
        if (record !== null && Temporal.Instant.compare(record.erasedAt, from) >= 0) {
          records.push(record);
        }
      }
      return records.sort(
        (a, b) =>
          Temporal.Instant.compare(a.erasedAt, b.erasedAt) ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      );
    },
  };
}
