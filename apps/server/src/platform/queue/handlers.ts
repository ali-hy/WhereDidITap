// F-91's handler map: the platform's handlers plus each module's (A-26). Modules add theirs in
// their own slices.
import type { WorkerContainer } from "../container.js";
import { captureRewrapJob, runCaptureRewrapJob } from "../crypto/rewrap.js";
import { fxHandlers } from "../fx/fxJobs.js";
import { maintenanceHandlers } from "../maintenance/maintenanceJobs.js";
import type { JobHandler } from "./workers.js";

export function buildHandlerMap(c: WorkerContainer): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([
    ...maintenanceHandlers(c),
    ...fxHandlers(c),
    [
      captureRewrapJob.name,
      async (_payload, ctx) => {
        await runCaptureRewrapJob(c, ctx.logger);
      },
    ],
  ]);
}
