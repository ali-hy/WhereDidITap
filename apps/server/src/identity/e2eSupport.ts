// Identity's entry in the e2e stack (A-509, §10.1). Test-only: only scripts/e2eModules.ts imports
// this file, so the production bundle holds none of the e2e code.
import type { E2eModule } from "../../scripts/e2eModules.js";
import { createMemoryEmailSender } from "./emailSender.js";
import { registerE2eTestRoutes } from "./e2eTestRoutes.js";
import * as settingsRepo from "./settingsRepo.js";

/** The user cap an e2e run is given, so parallel tests and retries never hit it. */
const E2E_USER_CAP = 100000;

export const identityE2e: E2eModule = () => {
  // One mailbox shared by the worker (which sends) and the test routes (which read).
  const sender = createMemoryEmailSender();
  return {
    // The API trusts X-Forwarded-For from vite preview's loopback proxy.
    apiEnv: { TRUSTED_PROXY: "127.0.0.1/32" },
    apiOverrides: {
      identityOverrides: {
        sender,
        testRoutes: (app, deps) => {
          registerE2eTestRoutes(app, deps, { sender });
        },
      },
    },
    workerOverrides: { identityOverrides: { sender } },
    afterSeed: async (worker) => {
      await settingsRepo.setUserCap(worker.database.handle, E2E_USER_CAP);
    },
  };
};
