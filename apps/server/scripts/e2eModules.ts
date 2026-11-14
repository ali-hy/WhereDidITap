// A-509: the module hook of `e2e:serve` (F-222). Each entry adds a module's environment, container
// overrides and a post-seed step to the e2e stack. Not bundled. Modules append theirs here.
import { identityE2e } from "../src/identity/e2eSupport.js";
import type {
  createApiContainer,
  createWorkerContainer,
  WorkerContainer,
} from "../src/platform/container.js";

export interface E2eModuleContext {
  dir: string;
  file(name: string, content: string): string;
  /** `http://localhost:<E2E_WEB_PORT>`: F-222's PUBLIC_ORIGIN. */
  webOrigin: URL;
  /** `http://127.0.0.1:<E2E_API_PORT>`. */
  apiOrigin: URL;
}

export interface E2eModuleSetup {
  apiEnv?: Readonly<Record<string, string>>;
  workerEnv?: Readonly<Record<string, string>>;
  apiOverrides?: Parameters<typeof createApiContainer>[1];
  workerOverrides?: Parameters<typeof createWorkerContainer>[1];
  afterSeed?: (worker: WorkerContainer) => Promise<void>;
}

export type E2eModule = (ctx: E2eModuleContext) => E2eModuleSetup | Promise<E2eModuleSetup>;

export const e2eModules: readonly E2eModule[] = [identityE2e];
