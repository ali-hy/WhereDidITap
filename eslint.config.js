import { createBudmonEslintConfig } from "@budmon/config/eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.data/**",
      "**/.tools/**",
      "**/playwright-report/**",
      "**/test-results/**",
      // A-318: review agents' temporary checkouts.
      ".claude/**",
    ],
  },
  ...createBudmonEslintConfig({ tsconfigRootDir: import.meta.dirname }),
];
