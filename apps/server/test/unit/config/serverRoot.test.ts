// F-25 serverRoot (A-43, A-60). TP-2.28. The cache is per start directory; each case still
// imports a fresh copy of the module so earlier cases can't leak into it.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerRoot = (fromUrl?: string) => string;

async function freshServerRoot(): Promise<ServerRoot> {
  vi.resetModules();
  const module = await import("../../../src/platform/config/serverRoot.js");
  return module.serverRoot;
}

let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "budmon-server-root-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(file: string, content = ""): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe("TP-2.28: serverRoot", () => {
  function serverTree(): string {
    const root = path.join(dir, "r");
    touch(path.join(root, "package.json"), JSON.stringify({ name: "@budmon/server" }));
    touch(path.join(root, "src/x/y.ts"));
    touch(path.join(root, "dist/main/chunks/z.js"));
    return root;
  }

  it("TP-2.28: from a source file under src/ it returns the @budmon/server directory", async () => {
    const root = serverTree();
    const serverRoot = await freshServerRoot();

    expect(serverRoot(pathToFileURL(path.join(root, "src/x/y.ts")).href)).toBe(root);
  });

  it("TP-2.28: from a bundle chunk under dist/main/chunks/ it returns the same directory", async () => {
    const root = serverTree();
    const serverRoot = await freshServerRoot();

    expect(serverRoot(pathToFileURL(path.join(root, "dist/main/chunks/z.js")).href)).toBe(root);
  });

  it('TP-2.28: a tree without @budmon/server\'s package.json throws Error("server root not found")', async () => {
    const other = path.join(dir, "other");
    touch(path.join(other, "package.json"), JSON.stringify({ name: "@budmon/web" }));
    const file = touch(path.join(other, "src/x/y.ts"));
    const serverRoot = await freshServerRoot();

    expect(() => serverRoot(pathToFileURL(file).href)).toThrow(new Error("server root not found"));
  });

  it("TP-2.28: a second tree r2 resolved after r gives r2 (the cache is per start directory)", async () => {
    const root = serverTree();
    const root2 = path.join(dir, "r2");
    touch(path.join(root2, "package.json"), JSON.stringify({ name: "@budmon/server" }));
    const file2 = touch(path.join(root2, "src/x/y.ts"));
    const serverRoot = await freshServerRoot();

    expect(serverRoot(pathToFileURL(path.join(root, "src/x/y.ts")).href)).toBe(root);
    expect(serverRoot(pathToFileURL(file2).href)).toBe(root2);
  });

  it("TP-2.44x: a not-found result isn't cached", async () => {
    const later = path.join(dir, "later");
    const file = touch(path.join(later, "src/x/y.ts"));
    const serverRoot = await freshServerRoot();

    expect(() => serverRoot(pathToFileURL(file).href)).toThrow(new Error("server root not found"));
    touch(path.join(later, "package.json"), JSON.stringify({ name: "@budmon/server" }));
    expect(serverRoot(pathToFileURL(file).href)).toBe(later);
  });

  it("TP-2.44x: with no argument it finds apps/server from its own location", async () => {
    const serverRoot = await freshServerRoot();

    expect(serverRoot()).toBe(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
    );
  });
});
