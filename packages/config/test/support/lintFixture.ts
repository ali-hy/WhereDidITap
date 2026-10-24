// Lints fixture files with the real `createBudmonEslintConfig` (F-1), the way TP-0.2 to TP-0.4
// describe: "ESLint API on fixture files".
//
// Each call builds a throwaway directory that looks like the repository (`apps/server/src/...`,
// `packages/shared/src/...`) so F-1's path-based `files` globs apply. The directory has its own
// `tsconfig.json` (for type-aware linting through `tsconfigRootDir`) and typed stubs for the
// third-party modules the fixtures import, so the fixtures type-check cleanly and only the rule
// under test can report.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { createBudmonEslintConfig } from "../../eslint/index.js";

const FIXTURE_TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "preserve",
    moduleResolution: "bundler",
    lib: ["ES2022", "DOM"],
    jsx: "preserve",
    types: [],
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["**/*.ts", "**/*.tsx"],
};

// JSX fixtures (TP-0.22) type-check against this minimal global JSX namespace, so they don't need
// solid-js installed in the fixture directory.
const JSX_GLOBALS = `declare global {
  namespace JSX {
    type Element = unknown;
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}
export {};
`;

const STUB_PACKAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "drizzle-orm": {
    "index.d.ts": "export declare function sql(strings: TemplateStringsArray): string;\n",
    "pg-core.d.ts": "export declare function text(): string;\n",
  },
  pg: {
    "index.d.ts": "export declare class Pool {\n  end(): Promise<void>;\n}\n",
  },
  "lucide-solid": {
    "index.d.ts": "export declare function Home(): unknown;\n",
  },
  pino: {
    "index.d.ts":
      "declare function pino(): { info(message: string): void };\nexport default pino;\n",
  },
};

export type LintMessages = Readonly<Record<string, readonly Linter.LintMessage[]>>;

/**
 * Writes `files` (repository-relative path → source) into a fresh directory, lints every one of
 * them with F-1's configuration, and returns the messages per path.
 *
 * Throws if a file wasn't linted (ignored, or no configuration matched it) or failed to parse, so
 * an expectation of "no error" can't pass because nothing ran.
 */
export async function lintFixture(files: Readonly<Record<string, string>>): Promise<LintMessages> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "budmon-eslint-")));
  try {
    await writeFile(path.join(root, "package.json"), '{ "type": "module", "private": true }\n');
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify(FIXTURE_TSCONFIG, null, 2));
    await writeFile(path.join(root, "jsx-globals.d.ts"), JSX_GLOBALS);
    for (const [name, stubFiles] of Object.entries(STUB_PACKAGES)) {
      const dir = path.join(root, "node_modules", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: "0.0.0", types: "index.d.ts" }),
      );
      for (const [file, source] of Object.entries(stubFiles)) {
        await writeFile(path.join(dir, file), source);
      }
    }
    for (const [relative, source] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, source);
    }

    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: createBudmonEslintConfig({ tsconfigRootDir: root }),
    });
    const results = await eslint.lintFiles(Object.keys(files));

    const byPath: Record<string, readonly Linter.LintMessage[]> = {};
    for (const result of results) {
      const relative = path.relative(root, result.filePath).split(path.sep).join("/");
      const broken = result.messages.filter(
        (m) => m.fatal === true || (m.ruleId === null && /ignored|no matching/i.test(m.message)),
      );
      if (broken.length > 0) {
        throw new Error(
          `Fixture ${relative} was not linted: ${broken.map((m) => m.message).join("; ")}`,
        );
      }
      byPath[relative] = result.messages;
    }
    for (const relative of Object.keys(files)) {
      if (!(relative in byPath)) {
        throw new Error(`Fixture ${relative} produced no lint result`);
      }
    }
    return byPath;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Errors (severity 2) reported for `file`. */
export function errorsIn(messages: LintMessages, file: string): Linter.LintMessage[] {
  const forFile = messages[file];
  if (forFile === undefined) {
    throw new Error(`No lint result for ${file}`);
  }
  return forFile.filter((m) => m.severity === 2);
}

/** Rule IDs of the errors reported for `file`. */
export function errorRuleIds(messages: LintMessages, file: string): (string | null)[] {
  return errorsIn(messages, file).map((m) => m.ruleId);
}
