// F-142's errors on a real directory (A-439): EACCES/EPERM become ObjectStoreError("denied") with
// the original error as `cause`; ENOENT keeps its handling. TP-10.13 (a), (b) and (d); (c) and
// (d2) are in test/unit/storage/fsObjectStoreErrors.test.ts. Root ignores mode bits, so (a) and
// (b) skip when run as root.
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixedClock } from "@budmon/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsObjectStore } from "../../../src/platform/storage/fsObjectStore.js";
import type { ObjectStore } from "../../../src/platform/storage/objectStore.js";
import { recordingLogger } from "../../support/platform.js";
import { USER, exportKey } from "../../support/s10.js";

const ROOT_USER = process.getuid?.() === 0;
const OTHER = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";

let root: string;
let exportsDir: string;
let store: ObjectStore;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "budmon-fs-denied-"));
  exportsDir = path.join(root, "exports");
  mkdirSync(exportsDir);
  mkdirSync(path.join(root, "erasure-log"));
  store = createFsObjectStore({
    root,
    publicOrigin: new URL("http://localhost:5173"),
    signingKey: null,
    clock: fixedClock("2026-10-12T12:00:00Z"),
    logger: recordingLogger(),
  });
});

afterEach(() => {
  // Modes restored before removal (TP-10.13).
  chmodSync(exportsDir, 0o700);
  rmSync(root, { recursive: true, force: true });
});

/** The error a promise rejects with (fails the test if it resolves). */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

function expectDenied(error: unknown, code: string) {
  expect(error).toMatchObject({ name: "ObjectStoreError", reason: "denied" });
  expect((error as { cause?: { code?: unknown } }).cause?.code).toBe(code);
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe.skipIf(ROOT_USER)("TP-10.13 (a): <root>/exports at mode 000 (A-439)", () => {
  beforeEach(() => {
    chmodSync(exportsDir, 0o000);
  });

  it("TP-10.13 (a): list rejects with denied, cause EACCES", async () => {
    expectDenied(await rejection(drain(store.list("exports", "users/"))), "EACCES");
  });

  it("TP-10.13 (a): put rejects with denied, cause EACCES", async () => {
    expectDenied(
      await rejection(store.put("exports", exportKey(), Buffer.from("x"), "application/zip")),
      "EACCES",
    );
  });

  it("TP-10.13 (a): delete rejects with denied, cause EACCES", async () => {
    expectDenied(await rejection(store.delete("exports", exportKey())), "EACCES");
  });

  it("TP-10.13 (a): deletePrefix rejects with denied, cause EACCES", async () => {
    expectDenied(await rejection(store.deletePrefix("exports", `users/${USER}/`)), "EACCES");
  });
});

describe.skipIf(ROOT_USER)(
  "TP-10.13 (b): the object's own parent directory at 0500 (A-439, A-440)",
  () => {
    // users/<uuid>/exports: readable, not writable, so neither creating a file nor unlinking one works.
    const parent = () => path.join(exportsDir, "users", USER, "exports");

    beforeEach(async () => {
      await store.put("exports", exportKey(), Buffer.from("x"), "application/zip");
      chmodSync(parent(), 0o500);
    });
    afterEach(() => {
      chmodSync(parent(), 0o700);
    });

    it("TP-10.13 (b): put of a second key in that directory rejects with denied, cause EACCES", async () => {
      expectDenied(
        await rejection(
          store.put("exports", exportKey(OTHER), Buffer.from("y"), "application/zip"),
        ),
        "EACCES",
      );
    });

    it("TP-10.13 (b): delete of the existing key rejects with denied, cause EACCES", async () => {
      expectDenied(await rejection(store.delete("exports", exportKey())), "EACCES");
    });
  },
);

describe("TP-10.13 (d): a missing bucket directory (unchanged)", () => {
  beforeEach(() => {
    rmSync(exportsDir, { recursive: true });
  });
  afterEach(() => {
    mkdirSync(exportsDir, { recursive: true });
  });

  it("TP-10.13 (d): list yields nothing", async () => {
    expect(await drain(store.list("exports", "users/"))).toEqual([]);
  });

  it("TP-10.13 (d): delete resolves", async () => {
    await expect(store.delete("exports", exportKey())).resolves.toBeUndefined();
  });
});
