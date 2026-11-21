// F-39 PasswordHasher (identity LLD §4.1). TP-0.6, plus extra cases TP-0.6x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { createPasswordHasher } from "../../../src/identity/passwordHasher.js";

const PLATFORM_PHC =
  "$argon2id$v=19$m=19456,t=2,p=1$nbQctopfMt/Rxtnnd7Vmjw$gfhUfLyXl09eRzeAGN5Io/+iZ/h4Cim32CsaUxZNnqE";
const WEAK_PHC =
  "$argon2id$v=19$m=4096,t=2,p=1$nbQctopfMt/Rxtnnd7Vmjw$gfhUfLyXl09eRzeAGN5Io/+iZ/h4Cim32CsaUxZNnqE";

/** Lets every pending promise callback and immediate run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

interface Deferred {
  plain: string;
  resolve: (phc: string) => void;
}

/** hashSecret whose calls for test passwords stay pending until resolved; the dummy resolves. */
function deferredHashSecret() {
  const pending: Deferred[] = [];
  const hashSecret = vi.fn((plain: string) => {
    if (plain.startsWith("dummy-")) return Promise.resolve(PLATFORM_PHC);
    return new Promise<string>((resolve) => {
      pending.push({ plain, resolve });
    });
  });
  return { hashSecret, pending };
}

describe("TP-0.6: PasswordHasher", () => {
  it("TP-0.6: five parallel hash calls: four run, the fifth waits until one finishes", async () => {
    const { hashSecret, pending } = deferredHashSecret();
    const hasher = createPasswordHasher({
      hashSecret,
      verifySecret: vi.fn(() => Promise.resolve(true)),
    });

    const results = ["p1", "p2", "p3", "p4", "p5"].map((p) => hasher.hash(p));
    await settle();

    expect(pending.map((d) => d.plain)).toHaveLength(4);
    expect(pending.map((d) => d.plain)).not.toContain("p5");

    pending[0]?.resolve(`$argon2id$done-${pending[0].plain}`);
    await settle();

    expect(pending.map((d) => d.plain)).toContain("p5");
    expect(pending).toHaveLength(5);
    for (const d of pending.slice(1)) d.resolve(`$argon2id$done-${d.plain}`);
    await expect(Promise.all(results)).resolves.toEqual([
      "$argon2id$done-p1",
      "$argon2id$done-p2",
      "$argon2id$done-p3",
      "$argon2id$done-p4",
      "$argon2id$done-p5",
    ]);
  });

  it("TP-0.6: verify(null, 'x') returns false and calls verifySecret once (against the dummy)", async () => {
    const { hashSecret } = deferredHashSecret();
    // Even a dummy that "matches" gives false: an unknown user never verifies.
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const hasher = createPasswordHasher({ hashSecret, verifySecret });

    const ok = await hasher.verify(null, "x");

    expect(ok).toBe(false);
    expect(verifySecret).toHaveBeenCalledTimes(1);
    expect(verifySecret.mock.calls[0]?.[0]).toBe(PLATFORM_PHC);
  });

  it("TP-0.6: needsRehash is true for m=4096 and false for the platform's parameters", () => {
    const hasher = createPasswordHasher({
      hashSecret: vi.fn(() => Promise.resolve(PLATFORM_PHC)),
      verifySecret: vi.fn(() => Promise.resolve(false)),
    });

    expect(hasher.needsRehash(WEAK_PHC)).toBe(true);
    expect(hasher.needsRehash(PLATFORM_PHC)).toBe(false);
  });
});

/** Records unhandled rejections while `fn` runs. */
async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    await fn();
    await settle();
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  return seen;
}

describe("TP-0.6 (A-19): a dummy hash that fails", () => {
  it("TP-0.6: the start-up dummy rejects once: no unhandled rejection; verify(null, 'x') is false after a second hash", async () => {
    const hashSecret = vi
      .fn<(plain: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("argon2 failed"))
      .mockResolvedValue(PLATFORM_PHC);
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    let ok: boolean | undefined;

    const unhandled = await unhandledDuring(async () => {
      const hasher = createPasswordHasher({ hashSecret, verifySecret });
      await settle();
      expect(hashSecret).toHaveBeenCalledTimes(1);

      ok = await hasher.verify(null, "x");
    });

    expect(unhandled).toEqual([]);
    expect(ok).toBe(false);
    expect(hashSecret).toHaveBeenCalledTimes(2);
    expect(verifySecret).toHaveBeenCalledTimes(1);
    expect(verifySecret.mock.calls[0]?.[0]).toBe(PLATFORM_PHC);
  });

  it("TP-0.6: a dummy hash that always rejects with E: two verify(null, 'x') calls reject with E; 3 hashes, no verify", async () => {
    const E = new Error("argon2 unavailable");
    const hashSecret = vi.fn<(plain: string) => Promise<string>>(() => Promise.reject(E));
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(false),
    );

    const unhandled = await unhandledDuring(async () => {
      const hasher = createPasswordHasher({ hashSecret, verifySecret });
      await settle();

      await expect(hasher.verify(null, "x")).rejects.toBe(E);
      await expect(hasher.verify(null, "x")).rejects.toBe(E);
    });

    expect(unhandled).toEqual([]);
    expect(hashSecret).toHaveBeenCalledTimes(3);
    expect(verifySecret).not.toHaveBeenCalled();
  });

  it("TP-0.6: with maxConcurrency 1 and a held hash, the dummy computation waits for the slot", async () => {
    let releaseHeld: ((phc: string) => void) | undefined;
    const hashSecret = vi
      .fn<(plain: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("argon2 failed"))
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseHeld = resolve;
          }),
      )
      .mockResolvedValue(PLATFORM_PHC);
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const hasher = createPasswordHasher({ hashSecret, verifySecret, maxConcurrency: 1 });
    await settle();
    expect(hashSecret).toHaveBeenCalledTimes(1);

    const held = hasher.hash("p");
    await settle();
    const unknownUser = hasher.verify(null, "x");
    await settle();

    expect(hashSecret).toHaveBeenCalledTimes(2);
    expect(hashSecret.mock.calls[1]?.[0]).toBe("p");

    releaseHeld?.("$argon2id$held");
    await expect(held).resolves.toBe("$argon2id$held");
    await expect(unknownUser).resolves.toBe(false);
    expect(hashSecret).toHaveBeenCalledTimes(3);
    expect(hashSecret.mock.calls[2]?.[0]).toMatch(/^dummy-/);
  });
});

describe("TP-0.6x: PasswordHasher details", () => {
  it("TP-0.6x: hash and verify pass the NFC-normalised password to P-F-66", async () => {
    const hashSecret = vi.fn<(plain: string) => Promise<string>>(() =>
      Promise.resolve(PLATFORM_PHC),
    );
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const hasher = createPasswordHasher({ hashSecret, verifySecret });

    await hasher.hash("Rémy-password");
    const ok = await hasher.verify(PLATFORM_PHC, "Rémy-password");

    expect(hashSecret.mock.calls.map((c) => c[0])).toContain("Rémy-password");
    expect(verifySecret).toHaveBeenLastCalledWith(PLATFORM_PHC, "Rémy-password");
    expect(ok).toBe(true);
  });

  it("TP-0.6x: verify with a stored PHC returns verifySecret's answer", async () => {
    const verifySecret = vi.fn<(phc: string, plain: string) => Promise<boolean>>(() =>
      Promise.resolve(false),
    );
    const hasher = createPasswordHasher({
      hashSecret: vi.fn(() => Promise.resolve(PLATFORM_PHC)),
      verifySecret,
    });

    await expect(hasher.verify(PLATFORM_PHC, "wrong")).resolves.toBe(false);
    expect(verifySecret).toHaveBeenCalledWith(PLATFORM_PHC, "wrong");
  });

  it("TP-0.6x: needsRehash is true for a different t or p", () => {
    const hasher = createPasswordHasher({
      hashSecret: vi.fn(() => Promise.resolve(PLATFORM_PHC)),
      verifySecret: vi.fn(() => Promise.resolve(false)),
    });

    expect(hasher.needsRehash(PLATFORM_PHC.replace("t=2", "t=3"))).toBe(true);
    expect(hasher.needsRehash(PLATFORM_PHC.replace("p=1", "p=2"))).toBe(true);
  });

  it("TP-0.6x: the real hasher hashes with argon2id at P-F-66's parameters and verifies", async () => {
    const hasher = createPasswordHasher();

    const phc = await hasher.hash("correct horse battery");

    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(phc, "correct horse battery")).resolves.toBe(true);
    await expect(hasher.verify(phc, "wrong horse battery")).resolves.toBe(false);
    await expect(hasher.verify("not a phc", "x")).resolves.toBe(false);
    expect(hasher.needsRehash(phc)).toBe(false);
  });
});
