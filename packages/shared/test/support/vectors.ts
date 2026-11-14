// Loads the shared test vectors (F-313), which the TypeScript and Android suites both read.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VECTORS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test-vectors",
);

export interface RoundingCase {
  num: string;
  den: string;
  expected: string;
}

export interface AllocateCase {
  minor: string;
  currency: string;
  weights: string[];
  expected: string[];
}

export interface ConvertSide {
  currency: string;
  unitsPerUsd: string;
  minorUnits: number;
}

export interface ConvertCase {
  minor: string;
  from: ConvertSide;
  to: ConvertSide;
  expected: string;
}

export interface WireCase {
  minor: string;
  expected: string;
}

export interface FormatCase {
  minor: string;
  currency: string;
  minorUnits: number;
  locale: string;
  expected: string;
}

export interface VectorFiles {
  rounding: RoundingCase;
  allocate: AllocateCase;
  convert: ConvertCase;
  wire: WireCase;
  format: FormatCase;
}

export function loadVectors<K extends keyof VectorFiles>(name: K): VectorFiles[K][] {
  const file = JSON.parse(readFileSync(path.join(VECTORS_DIR, `${name}.json`), "utf8")) as {
    version: unknown;
    cases: VectorFiles[K][];
  };
  if (file.version !== 1) throw new Error(`${name}.json: unsupported version`);
  return file.cases;
}

/** F-313: format comparisons normalise U+00A0 and U+202F to U+0020 on both sides. */
export function normaliseSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}
