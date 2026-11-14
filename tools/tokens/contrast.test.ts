// P-A-513 (1): the contrast report over the generated tokens (guide §3.4; D-39: reported, never
// blocking). TP-0b.2. The report lists every guide §3.4 pair for every theme × mode in
// apps/web/src/styles/tokens.css and is written to test-results/tokens-contrast.md (git-ignored).
// A pair below its threshold is marked in the report; it never fails the run. The cases fail only
// when the tokens file is missing or malformed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOKENS_CSS = path.join(ROOT, "apps/web/src/styles/tokens.css");
const REPORT = path.join(ROOT, "test-results/tokens-contrast.md");

/** Guide §3.4's pairs: [foreground, background, minimum ratio]. */
const STATUSES = ["danger", "success", "warning", "info"] as const;
export const PAIRS: readonly (readonly [string, string, number])[] = [
  ["fg", "canvas", 4.5],
  ["fg", "surface", 4.5],
  ["fg-muted", "canvas", 4.5],
  ["fg-muted", "surface", 4.5],
  ["fg-muted", "surface-raised", 4.5],
  ["on-accent", "accent", 4.5],
  ["on-accent", "accent-hover", 4.5],
  ["accent-fg", "canvas", 4.5],
  ["accent-fg", "surface", 4.5],
  ["on-accent-tint", "accent-tint", 4.5],
  ["line-strong", "surface", 3],
  ["line-strong", "canvas", 3],
  ["focus", "canvas", 3],
  ["focus", "surface", 3],
  ...STATUSES.map((s) => [s, "surface", 4.5] as const),
  ...STATUSES.map((s) => [`on-${s}-tint`, `${s}-tint`, 4.5] as const),
  ["on-danger", "danger", 4.5],
];

export interface Block {
  theme: string;
  mode: string;
  vars: Record<string, string>;
}

/** The `:root[data-theme][data-mode] { --c-<token>: #rrggbb; … }` blocks of guide §14. */
export function parseBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  const blockRe = /:root\[data-theme="([a-z0-9-]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(blockRe)) {
    const vars: Record<string, string> = {};
    for (const v of (m[3] ?? "").matchAll(/--c-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[v[1] ?? ""] = (v[2] ?? "").trim();
    }
    blocks.push({ theme: m[1] ?? "", mode: m[2] ?? "", vars });
  }
  return blocks;
}

/** WCAG 2.x relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Row {
  theme: string;
  mode: string;
  fg: string;
  bg: string;
  ratio: number;
  needs: number;
  passes: boolean;
}

/** One row per pair × block; never throws for a low ratio. */
export function reportRows(blocks: readonly Block[]): Row[] {
  return blocks.flatMap((b) =>
    PAIRS.map(([fg, bg, needs]) => {
      const ratio = contrast(b.vars[fg] ?? "", b.vars[bg] ?? "");
      return { theme: b.theme, mode: b.mode, fg, bg, ratio, needs, passes: ratio >= needs };
    }),
  );
}

export function renderReport(rows: readonly Row[]): string {
  const lines = [
    "# Token contrast report (guide §3.4; D-39: reported, not blocking)",
    "",
    "| Theme | Mode | Pair | Ratio | Needs | Result |",
    "| ----- | ---- | ---- | ----- | ----- | ------ |",
    ...rows.map(
      (r) =>
        `| ${r.theme} | ${r.mode} | \`${r.fg}\` on \`${r.bg}\` | ${r.ratio.toFixed(2)} | ${String(r.needs)} | ${r.passes ? "pass" : "**below**"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const needed = [...new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))];

describe("TP-0b.2: the contrast report", () => {
  it("TP-0b.2: tokens.css has a light and a dark block for each theme, teal among them", () => {
    const blocks = parseBlocks(readFileSync(TOKENS_CSS, "utf8"));

    expect(blocks.some((b) => b.theme === "teal" && b.mode === "light")).toBe(true);
    expect(blocks.some((b) => b.theme === "teal" && b.mode === "dark")).toBe(true);
    for (const theme of new Set(blocks.map((b) => b.theme))) {
      expect(
        blocks
          .filter((b) => b.theme === theme)
          .map((b) => b.mode)
          .sort(),
      ).toEqual(["dark", "light"]);
    }
  });

  it("TP-0b.2: every token a pair needs is a #rrggbb value in every block", () => {
    const blocks = parseBlocks(readFileSync(TOKENS_CSS, "utf8"));
    expect(blocks.length).toBeGreaterThan(0);

    const missing = blocks.flatMap((b) =>
      needed.filter((t) => !HEX.test(b.vars[t] ?? "")).map((t) => `${b.theme}/${b.mode}: --c-${t}`),
    );
    expect(missing).toEqual([]);
  });

  it("TP-0b.2: the report has a row for every pair × theme × mode and is written; low ratios are reported, not failed", () => {
    const blocks = parseBlocks(readFileSync(TOKENS_CSS, "utf8"));
    const rows = reportRows(blocks);

    expect(rows).toHaveLength(blocks.length * PAIRS.length);
    mkdirSync(path.dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, renderReport(rows));
    const written = readFileSync(REPORT, "utf8");
    for (const b of blocks) {
      for (const [fg, bg] of PAIRS) {
        expect(written).toContain(`| ${b.theme} | ${b.mode} | \`${fg}\` on \`${bg}\` |`);
      }
    }
  });
});

describe("TP-0b.2x: the report's arithmetic and its non-blocking rule", () => {
  it("TP-0b.2x: black on white is 21:1 and a colour on itself 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#07736B", "#07736B")).toBeCloseTo(1, 5);
  });

  it("TP-0b.2x: guide §3.2's teal light fg on canvas is about guide §3.4's 16.1", () => {
    expect(contrast("#131D1C", "#F3F8F7")).toBeCloseTo(16.1, 0);
  });

  it("TP-0b.2x: a block whose pairs are all below threshold yields 'below' rows without throwing", () => {
    const grey = Object.fromEntries(needed.map((t) => [t, "#808080"]));
    const rows = reportRows([{ theme: "probe", mode: "light", vars: grey }]);

    expect(rows.every((r) => !r.passes)).toBe(true);
    expect(renderReport(rows)).toContain("**below**");
  });
});
