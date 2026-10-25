// F-9 checkCatalogs and usedMessageIds (D-37). TP-11.23, plus extra cases TP-11.31x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCatalogs, usedMessageIds } from "../checkCatalogs.js";

describe("TP-11.23: catalog completeness (F-9)", () => {
  it("TP-11.23: used {a, b} with en {a} is missing {en: [b]}", () => {
    expect(checkCatalogs({ usedIds: new Set(["a", "b"]), catalogs: { en: { a: "A" } } })).toEqual({
      missing: { en: ["b"] },
    });
  });

  it("TP-11.23 (A-312): used {a} with en {a} is {en: []}: every shipped locale is a key", () => {
    expect(checkCatalogs({ usedIds: new Set(["a"]), catalogs: { en: { a: "A" } } })).toEqual({
      missing: { en: [] },
    });
  });

  it("TP-11.31x (A-312): each locale's missing list is sorted", () => {
    expect(checkCatalogs({ usedIds: new Set(["c", "a", "b"]), catalogs: { en: {} } })).toEqual({
      missing: { en: ["a", "b", "c"] },
    });
  });
});

// Review B-2 (a): the ID extraction itself, on a throwaway root.
describe("TP-11.31x: usedMessageIds (F-9, A-12, review B-2)", () => {
  it("TP-11.31x: apps/web/src/a/x.tsx with t(…), x.t(…), intl.formatMessage(…) and defineMessages(…) gives exactly those four IDs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "budmon-catalog-ids-"));
    try {
      const dir = path.join(root, "apps/web/src/a");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "x.tsx"),
        `declare function t(d: unknown): string;
declare const x: { t(d: unknown): string };
declare const intl: { formatMessage(d: unknown): string };
declare function defineMessages<T>(m: T): T;

export const a = t({ id: "fixture.call", defaultMessage: "Call" });
export const b = x.t({ id: "fixture.member", defaultMessage: "Member" });
export const c = intl.formatMessage({ id: "fixture.intl", defaultMessage: "Intl" });
export const d = defineMessages({ one: { id: "fixture.defined", defaultMessage: "Defined" } });
`,
      );

      const ids = await usedMessageIds(root);

      expect([...ids].sort()).toEqual(
        ["fixture.call", "fixture.defined", "fixture.intl", "fixture.member"].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// A-323: the CLI's --root override, spawned against fixture roots.
describe("TP-11.23 (A-323): the checkCatalogs CLI with --root", () => {
  const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const TSX = path.join(TOOLS, "node_modules/.bin/tsx");

  function cli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(TSX, ["checkCatalogs.ts", ...args], {
      cwd: TOOLS,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function fixture(en: Record<string, string>, withSrc = true): string {
    const root = mkdtempSync(path.join(tmpdir(), "budmon-catalog-cli-"));
    const messages = path.join(root, "apps/web/src/i18n/messages");
    if (withSrc) {
      mkdirSync(messages, { recursive: true });
      writeFileSync(
        path.join(root, "apps/web/src/x.tsx"),
        'declare function t(d: unknown): string;\nexport const a = t({ id: "a.b", defaultMessage: "x" });\n',
      );
      writeFileSync(path.join(messages, "en.json"), JSON.stringify(en));
    }
    return root;
  }

  it("TP-11.23 (A-323): a missing ID exits 1 with stderr exactly missing en: a.b", () => {
    const root = fixture({});
    try {
      const { status, stdout, stderr } = cli(["--root", root]);

      expect(status, stderr).toBe(1);
      expect(stderr.trim()).toBe("missing en: a.b");
      expect(stdout).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("TP-11.23 (A-323): a complete catalog exits 0 with no output", () => {
    const root = fixture({ "a.b": "x" });
    try {
      const { status, stdout, stderr } = cli(["--root", root]);

      expect(status, stderr).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("TP-11.23 (A-323): --bogus exits 64 with the usage text", () => {
    const { status, stdout, stderr } = cli(["--bogus"]);

    expect(status).toBe(64);
    expect(`${stdout}${stderr}`).toMatch(/usage/i);
    expect(`${stdout}${stderr}`).toContain("--root");
  }, 60_000);

  it("TP-11.23 (A-323): a root without apps/web/src exits 64", () => {
    const root = fixture({}, false);
    try {
      expect(cli(["--root", root]).status).toBe(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
