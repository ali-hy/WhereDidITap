// F-142's errors with node:fs/promises mocked (A-439). TP-10.13 (c) and (d2): writeFile's EPERM
// becomes ObjectStoreError("denied") with the original as `cause`; EIO surfaces unchanged. The
// real-directory cases are in test/integration/storage/fsObjectStoreErrors.test.ts.
import { fixedClock } from "@budmon/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsObjectStore } from "../../../src/platform/storage/fsObjectStore.js";
import { ObjectStoreError } from "../../../src/platform/storage/objectStore.js";
import { recordingLogger } from "../../support/platform.js";
import { exportKey } from "../../support/s10.js";

const fsMock = vi.hoisted(() => ({ writeFileCode: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    // mkdir succeeds without touching the disk, so only writeFile decides the outcome.
    mkdir: () => Promise.resolve(undefined),
    writeFile: () => {
      const code = fsMock.writeFileCode;
      if (code === null) return Promise.resolve();
      return Promise.reject(Object.assign(new Error(`${code}: mocked writeFile`), { code }));
    },
  };
});

afterEach(() => {
  fsMock.writeFileCode = null;
});

const store = () =>
  createFsObjectStore({
    root: "/nonexistent/budmon-tp10-13",
    publicOrigin: new URL("http://localhost:5173"),
    signingKey: null,
    clock: fixedClock("2026-10-12T12:00:00Z"),
    logger: recordingLogger(),
  });

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("TP-10.13 (c), (d2): put when writeFile fails (A-439)", () => {
  it("TP-10.13 (c): EPERM → ObjectStoreError denied, cause.code EPERM", async () => {
    fsMock.writeFileCode = "EPERM";

    const error = await rejection(
      store().put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).toBeInstanceOf(ObjectStoreError);
    expect(error).toMatchObject({ reason: "denied" });
    expect((error as { cause?: { code?: unknown } }).cause?.code).toBe("EPERM");
  });

  it("TP-10.13 (d2): EIO → the original error, not an ObjectStoreError", async () => {
    fsMock.writeFileCode = "EIO";

    const error = await rejection(
      store().put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    );

    expect(error).not.toBeInstanceOf(ObjectStoreError);
    expect(error).toMatchObject({ code: "EIO", message: "EIO: mocked writeFile" });
  });

  it("TP-10.13 (c): with writeFile succeeding, put resolves (the mock itself is sound)", async () => {
    await expect(
      store().put("exports", exportKey(), Buffer.from("x"), "application/zip"),
    ).resolves.toBeUndefined();
  });
});
