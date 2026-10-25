// The rehearsal's in-stack checks (F-195 step 7, A-445): run by the harness against a running
// rehearsal stack, never by `pnpm test` (the tools project includes only tools/*/test/**).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["checks/**/*.test.ts"],
    environment: "node",
    // One stack: the flows share it and F6 waits on the worker.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
