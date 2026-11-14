// F-22 step 0, ensureDevEnv (A-63). TP-2.31, plus extra cases TP-2.61x.
// Importing main/dev.ts must not start the development stack (an entry guard, as in F-6/F-94).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDevEnv } from "../../../src/main/dev.js";

const ROOT = "/repo";
const EXAMPLE = path.join(ROOT, ".env.example");
const ENV = path.join(ROOT, ".env");
const SUPERUSER_URL = "postgres://postgres:postgres@localhost:5432/postgres";
const EXAMPLE_TEXT = `A=1\nDEV_SUPERUSER_URL=${SUPERUSER_URL}\n`;

interface FakeFs {
  files: Map<string, string>;
  copies: [string, string][];
  logs: string[];
  deps: Parameters<typeof ensureDevEnv>[2];
}

function fakeFs(initial: Record<string, string>): FakeFs {
  const files = new Map(Object.entries(initial));
  const copies: [string, string][] = [];
  const logs: string[] = [];
  return {
    files,
    copies,
    logs,
    deps: {
      exists: (p) => files.has(p),
      copyFile: (from, to) => {
        copies.push([from, to]);
        const content = files.get(from);
        if (content === undefined) throw new Error(`ENOENT: ${from}`);
        files.set(to, content);
      },
      readFile: (p) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      log: (line) => logs.push(line),
    },
  };
}

describe("TP-2.31: ensureDevEnv", () => {
  it("TP-2.31 (a): without .env, copies .env.example once, logs it, and returns the example's values", () => {
    const fs = fakeFs({ [EXAMPLE]: EXAMPLE_TEXT });

    const env = ensureDevEnv(ROOT, {}, fs.deps);

    expect(fs.copies).toEqual([[EXAMPLE, ENV]]);
    expect(fs.logs).toEqual(["Created .env from .env.example"]);
    expect(env).toMatchObject({ A: "1", DEV_SUPERUSER_URL: SUPERUSER_URL });
  });

  it("TP-2.31 (b): an existing .env isn't copied over or logged, and its values are used", () => {
    const fs = fakeFs({ [EXAMPLE]: EXAMPLE_TEXT, [ENV]: "A=2\n" });

    const env = ensureDevEnv(ROOT, {}, fs.deps);

    expect(fs.copies).toEqual([]);
    expect(fs.logs).toEqual([]);
    expect(env["A"]).toBe("2");
    expect(fs.files.get(ENV)).toBe("A=2\n");
  });

  it("TP-2.31 (c): a variable set in the shell wins over .env", () => {
    const fs = fakeFs({ [EXAMPLE]: EXAMPLE_TEXT });

    const env = ensureDevEnv(ROOT, { A: "9" }, fs.deps);

    expect(env["A"]).toBe("9");
    expect(env["DEV_SUPERUSER_URL"]).toBe(SUPERUSER_URL);
  });

  it("TP-2.61x: shell variables that aren't in .env are kept in the result", () => {
    const fs = fakeFs({ [EXAMPLE]: EXAMPLE_TEXT });

    const env = ensureDevEnv(ROOT, { PATH: "/usr/bin" }, fs.deps);

    expect(env["PATH"]).toBe("/usr/bin");
  });

  it("TP-2.61x: .env is parsed with parseEnv rules (comments, quotes, blank lines)", () => {
    const fs = fakeFs({
      [EXAMPLE]: EXAMPLE_TEXT,
      [ENV]: '# development\n\nA="quoted value"\nB=plain # trailing comment\n',
    });

    const env = ensureDevEnv(ROOT, {}, fs.deps);

    expect(env["A"]).toBe("quoted value");
    expect(env["B"]).toBe("plain");
  });
});
