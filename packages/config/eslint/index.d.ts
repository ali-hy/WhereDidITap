import type { Linter } from "eslint";

export interface BudmonEslintOptions {
  /** Directory that holds the `tsconfig.json` files used for type-aware linting. */
  tsconfigRootDir: string;
}

export function createBudmonEslintConfig(options: BudmonEslintOptions): Linter.Config[];
