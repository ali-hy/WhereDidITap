// F-25: the @budmon/server package root, the same in source and in the bundle.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cache = new Map<string, string>();

function isServerPackage(dir: string): boolean {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name === "@budmon/server";
  } catch {
    return false;
  }
}

export function serverRoot(fromUrl: string = import.meta.url): string {
  const start = path.dirname(fileURLToPath(fromUrl));
  const cached = cache.get(start);
  if (cached !== undefined) return cached;
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (isServerPackage(dir)) {
      cache.set(start, dir);
      return dir;
    }
    if (path.dirname(dir) === dir) {
      throw new Error("server root not found");
    }
  }
}
