// F-59 (A-26): the implemented router root, mirroring the contract key for key.
import { metaRouter } from "./meta.js";
import { base } from "./procedures.js";

export const appRouter = base.router({
  meta: metaRouter,
  // Modules add their keys.
});

export type AppRouter = typeof appRouter;
