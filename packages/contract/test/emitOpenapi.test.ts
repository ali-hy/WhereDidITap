// F-347 emitOpenapi. TP-4.1 (the committed packages/contract/openapi.json is what the contract
// emits; CI's `pnpm contract:openapi && git diff --exit-code` fails on a stale file), plus extra
// cases TP-4.34x (deterministic output). IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_VERSION } from "../src/index.js";
import { emitOpenapi } from "../scripts/emitOpenapi.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMITTED = path.join(PACKAGE_DIR, "openapi.json");

function sortedKeysEverywhere(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(sortedKeysEverywhere);
  if (typeof value !== "object" || value === null) return true;
  const keys = Object.keys(value);
  const sorted = [...keys].sort();
  return keys.every((k, i) => k === sorted[i]) && Object.values(value).every(sortedKeysEverywhere);
}

describe("TP-4.1: openapi.json drift", () => {
  it("TP-4.1: the committed openapi.json equals what emitOpenapi returns", async () => {
    expect(readFileSync(COMMITTED, "utf8")).toBe(await emitOpenapi());
  });

  it("TP-4.1: a stale committed file differs from the emitted one, so git diff --exit-code fails", async () => {
    const emitted = await emitOpenapi();
    const stale = emitted.replace('"/meta/client-config"', '"/meta/client-config-old"');
    const dir = mkdtempSync(path.join(tmpdir(), "budmon-drift-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], {
        cwd: dir,
        stdio: "pipe",
      });
    try {
      writeFileSync(path.join(dir, "openapi.json"), stale);
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", "stale");
      // What `pnpm contract:openapi` does: write the emitted text over the committed file.
      writeFileSync(path.join(dir, "openapi.json"), emitted);

      expect(() => git("diff", "--exit-code")).toThrow();
      git("add", ".");
      git("commit", "-qm", "fresh");
      writeFileSync(path.join(dir, "openapi.json"), emitted);
      expect(() => git("diff", "--exit-code")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("TP-4.34x: emitOpenapi output (F-347)", () => {
  it("TP-4.34x: two runs give identical text", async () => {
    expect(await emitOpenapi()).toBe(await emitOpenapi());
  });

  it("TP-4.34x: keys are sorted recursively, 2-space indented, with a trailing newline", async () => {
    const text = await emitOpenapi();
    const doc: unknown = JSON.parse(text);

    expect(sortedKeysEverywhere(doc)).toBe(true);
    expect(text).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });

  it("TP-4.34x: info and servers are as F-347 says", async () => {
    const doc = JSON.parse(await emitOpenapi()) as { info: unknown; servers: unknown };

    expect(doc.info).toMatchObject({ title: "Budmon API", version: API_VERSION });
    expect(doc.servers).toEqual([{ url: "/api/v1" }]);
  });
});
