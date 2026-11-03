// S-10 test support (object storage, erasure log, restore verification), owned by the
// test-architect: listing and failure helpers and valid keys.
import type { BucketName, ObjectStore } from "../../src/platform/storage/objectStore.js";

/** Every key `store.list(bucket, prefix)` yields, in order. */
export async function keysOf(
  store: ObjectStore,
  bucket: BucketName,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  for await (const entry of store.list(bucket, prefix)) keys.push(entry.key);
  return keys;
}

/** What `fn` throws or rejects with (undefined if it doesn't). */
export async function failure(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// A valid user id and export ids (lower-case UUIDs, as the key rules want).
export const USER = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
export const EXPORT_ID = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
export const exportKey = (id: string = EXPORT_ID, ext = "zip", user: string = USER) =>
  `users/${user}/exports/${id}.${ext}`;
