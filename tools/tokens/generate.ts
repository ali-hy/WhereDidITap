// P-A-513 (1), A-514: turns tools/tokens/recipes.json into the web's tokens.css and Android's
// Tokens.kt. `tsx tools/tokens/generate.ts [--check] [--root <dir>]`.
// Exit codes: 0 done or current; 1 --check found a stale or missing output; 2 bad recipes or usage.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_PATH = "apps/web/src/styles/tokens.css";
const KT_PATH = "apps/android/app/src/main/java/com/budmon/app/ui/theme/Tokens.kt";
const RECIPES_PATH = "tools/tokens/recipes.json";
const USAGE = "usage: generate.ts [--check] [--root <dir>]";

type Mode = "light" | "dark";
type Chroma = number | string;
type Lc = readonly [number, Chroma];

interface Hue {
  h: number;
  c: number;
}

interface Recipes {
  themes: Record<string, Hue>;
  statuses: Record<string, Hue>;
  tokens: Record<string, { hue: "theme"; light: Lc; dark: Lc }>;
  statusTokens: Record<string, { light: Lc; dark: Lc }>;
  aliases: Record<string, { light: string; dark: string }>;
}

class RecipeError extends Error {}

// OKLCH to sRGB (Ottosson's matrices).
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Lowers chroma until the colour fits sRGB. */
function toLinearInGamut(L: number, C: number, hueDeg: number): [number, number, number] {
  const rad = (hueDeg * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(rad), c * Math.sin(rad));
  let rgb = at(C);
  if (inGamut(rgb)) return rgb;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  rgb = at(lo);
  return rgb;
}

function encode(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  const gamma = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(gamma * 255);
}

function oklchHex(L: number, C: number, hueDeg: number): string {
  const rgb = toLinearInGamut(L, C, hueDeg);
  return `#${rgb.map((v) => encode(v).toString(16).padStart(2, "0")).join("")}`;
}

/** `C` and `c` are the hue's chroma; "0.8c" scales it. */
function chromaOf(spec: Chroma, hue: Hue): number {
  if (typeof spec === "number") return spec;
  const m = /^(\d*\.?\d*)[Cc]$/.exec(spec);
  if (m === null) throw new RecipeError(`bad chroma ${spec}`);
  return (m[1] === "" ? 1 : Number(m[1])) * hue.c;
}

const isLc = (v: unknown): v is Lc =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && v[1] !== undefined;

function validate(raw: unknown): Recipes {
  const r = raw as Partial<Recipes> | null;
  if (r === null || typeof r !== "object") throw new RecipeError("not an object");
  for (const key of ["themes", "statuses", "tokens", "statusTokens", "aliases"] as const) {
    if (typeof r[key] !== "object") throw new RecipeError(`${key} missing`);
  }
  const recipes = r as Recipes;
  if (Object.keys(recipes.themes).length === 0) throw new RecipeError("no themes");
  const lcs = [
    ...Object.values(recipes.tokens).flatMap((t) => [t.light, t.dark]),
    ...Object.values(recipes.statusTokens).flatMap((t) => [t.light, t.dark]),
  ];
  if (!lcs.every(isLc)) throw new RecipeError("a token needs [lightness, chroma] per mode");
  return recipes;
}

type Palette = Record<Mode, Map<string, string>>;

/** Every token of one theme in both modes, in output order. */
function buildTheme(recipes: Recipes, hue: Hue): Palette {
  const palette: Palette = { light: new Map(), dark: new Map() };
  for (const mode of ["light", "dark"] as const) {
    const out = palette[mode];
    for (const [name, t] of Object.entries(recipes.tokens)) {
      const [L, C] = t[mode];
      out.set(name, oklchHex(L, chromaOf(C, hue), hue.h));
    }
    for (const [status, sHue] of Object.entries(recipes.statuses)) {
      for (const [pattern, t] of Object.entries(recipes.statusTokens)) {
        const [L, C] = t[mode];
        out.set(pattern.replace("{status}", status), oklchHex(L, chromaOf(C, sHue), sHue.h));
      }
      if (status === "danger") addAliases(recipes, palette, mode, ["on-danger"]);
    }
  }
  // Aliases that need both modes' values come last.
  for (const mode of ["light", "dark"] as const) {
    addAliases(recipes, palette, mode, ["income", "inverse", "on-inverse"]);
  }
  return palette;
}

function addAliases(
  recipes: Recipes,
  palette: Palette,
  mode: Mode,
  names: readonly string[],
): void {
  for (const name of names) {
    const spec = recipes.aliases[name]?.[mode];
    if (spec === undefined) throw new RecipeError(`alias ${name} missing`);
    palette[mode].set(name, resolveAlias(spec, palette, mode));
  }
}

function resolveAlias(spec: string, palette: Palette, mode: Mode): string {
  if (spec.startsWith("#")) return spec;
  if (!spec.startsWith("=")) throw new RecipeError(`bad alias ${spec}`);
  const [first, second] = spec.slice(1).split(":");
  const [from, token] =
    second === undefined ? [mode, first] : [first === "light" ? "light" : "dark", second];
  const value = palette[from as Mode].get(token ?? "");
  if (value === undefined) throw new RecipeError(`alias target ${spec} missing`);
  return value;
}

const HEADER = "Generated by tools/tokens/generate.ts from tools/tokens/recipes.json. Do not edit.";

function renderCss(recipes: Recipes): string {
  const blocks = Object.entries(recipes.themes).flatMap(([theme, hue]) => {
    const palette = buildTheme(recipes, hue);
    return (["light", "dark"] as const).map((mode) => {
      const vars = [...palette[mode]].map(([name, hex]) => `  --c-${name}: ${hex};`).join("\n");
      return `:root[data-theme="${theme}"][data-mode="${mode}"] {\n  color-scheme: ${mode};\n${vars}\n}\n`;
    });
  });
  return `/* ${HEADER} */\n\n${blocks.join("\n")}`;
}

const camel = (name: string): string =>
  name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const pascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

function renderKotlin(recipes: Recipes): string {
  const tokenNames = [...buildTheme(recipes, Object.values(recipes.themes)[0] as Hue).light.keys()];
  const fields = tokenNames.map((n) => `    val ${camel(n)}: Color,`).join("\n");
  const themes = Object.entries(recipes.themes)
    .map(([theme, hue]) => {
      const palette = buildTheme(recipes, hue);
      const set = (mode: Mode): string =>
        [...palette[mode]]
          .map(([n, hex]) => `            ${camel(n)} = Color(0xFF${hex.slice(1).toUpperCase()}),`)
          .join("\n");
      return `    object ${pascal(theme)} {
        val Light =
            TokenSet(
${set("light")}
            )
        val Dark =
            TokenSet(
${set("dark")}
            )
    }`;
    })
    .join("\n");
  return `// ${HEADER}
package com.budmon.app.ui.theme

import androidx.compose.ui.graphics.Color

/** One colour per token of guide §3.1, for one theme and mode. */
data class TokenSet(
${fields}
)

object Tokens {
${themes}
}
`;
}

interface Args {
  check: boolean;
  root: string;
}

function parseArgs(argv: readonly string[]): Args | null {
  let check = false;
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined) return null;
      root = path.resolve(value);
      i += 1;
    } else return null;
  }
  return { check, root };
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    console.error(USAGE);
    return 2;
  }
  let recipes: Recipes;
  try {
    recipes = validate(JSON.parse(readFileSync(path.join(args.root, RECIPES_PATH), "utf8")));
    // Building once surfaces bad aliases and chromas before any file is touched.
    renderCss(recipes);
  } catch (e) {
    console.error(`recipes invalid: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const outputs: [string, string][] = [
    [CSS_PATH, renderCss(recipes)],
    [KT_PATH, renderKotlin(recipes)],
  ];
  if (args.check) {
    const stale = outputs.filter(([rel, content]) => {
      const file = path.join(args.root, rel);
      return !existsSync(file) || readFileSync(file, "utf8") !== content;
    });
    for (const [rel] of stale) console.error(`stale: ${rel}`);
    return stale.length === 0 ? 0 : 1;
  }
  for (const [rel, content] of outputs) {
    const file = path.join(args.root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
