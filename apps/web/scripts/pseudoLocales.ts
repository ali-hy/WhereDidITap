// F-207: pseudo-locales from the English catalog. Only literal text is transformed, so ICU
// arguments, plural and select keywords, and tags survive (A-310: the Vite plugin and the
// web-unit set-up both call writePseudoLocales).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";

const ACCENTS: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ļ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};
const RLM = String.fromCodePoint(0x200f);

/** The printer declares its own copy of the AST types; the shapes are the parser's. */
function print(ast: MessageFormatElement[]): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- same enum, two declarations
  return printAST(ast);
}

/** A copy of `ast` with every literal's text passed through `literal`. */
function mapLiterals(
  ast: readonly MessageFormatElement[],
  literal: (text: string) => string,
): MessageFormatElement[] {
  return ast.map((el): MessageFormatElement => {
    switch (el.type) {
      case TYPE.literal:
        return { ...el, value: el.value === "" ? "" : literal(el.value) };
      case TYPE.plural:
      case TYPE.select:
        return {
          ...el,
          options: Object.fromEntries(
            Object.entries(el.options).map(([key, option]) => [
              key,
              { ...option, value: mapLiterals(option.value, literal) },
            ]),
          ),
        };
      case TYPE.tag:
        return { ...el, children: mapLiterals(el.children, literal) };
      default:
        return el;
    }
  });
}

function literalElement(value: string): MessageFormatElement {
  return { type: TYPE.literal, value };
}

/** Accented look-alikes, `~` padding (one per 3 characters), the whole wrapped as `[…]`. */
export function toAccented(icuMessage: string): string {
  const ast = mapLiterals(parse(icuMessage), (text) => {
    const accented = text.replace(/[A-Za-z]/g, (ch) => ACCENTS[ch] ?? ch);
    return accented + "~".repeat(Math.floor(text.length / 3));
  });
  return print([literalElement("["), ...ast, literalElement("]")]);
}

/** Each literal segment between RLMs, so the layout flips while the text stays readable. */
export function toRtlPseudo(icuMessage: string): string {
  return print(mapLiterals(parse(icuMessage), (text) => `${RLM}${text}${RLM}`));
}

/** Writes `<outDir>/en-XA.json` and `<outDir>/ar-XB.json` from the English catalog. */
export function writePseudoLocales(opts: { enCatalogPath: string; outDir: string }): void {
  const en = JSON.parse(readFileSync(opts.enCatalogPath, "utf8")) as Record<string, string>;
  const transform = (fn: (m: string) => string) =>
    `${JSON.stringify(
      Object.fromEntries(Object.entries(en).map(([id, message]) => [id, fn(message)])),
      null,
      2,
    )}\n`;
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(path.join(opts.outDir, "en-XA.json"), transform(toAccented));
  writeFileSync(path.join(opts.outDir, "ar-XB.json"), transform(toRtlPseudo));
}
