// F-76: every job handler runs through this wrapper.
import type { Clock } from "@budmon/shared";
import { Temporal } from "@budmon/shared";
import type { JobWithMetadata } from "pg-boss";
import { BudmonError } from "../errors/BudmonError.js";
import type { ErrorReporter } from "../observability/errorReporter.js";
import type { Logger } from "../observability/logger.js";
import type { PlatformMetrics } from "../observability/metrics.js";
import { describeFailure } from "../observability/describeFailure.js";
import { ERROR_KEY } from "../observability/safeFields.js";
import { sanitizeError } from "../observability/sanitize.js";
import { JobPayloadInvalidError } from "./jobQueue.js";
import type { JobDefinition } from "./jobs.js";

/**
 * What pg-boss stores as a failed job's output: `message` (the sanitised key, code or class) and
 * `stack` (sanitised frames), and nothing else.
 */
export class JobFailure extends Error {
  /** pg-boss serialises a failure with serialize-error, which uses toJSON when present: only
   * these two fields are stored (otherwise `name` would be added). */
  toJSON(): { message: string; stack: string | undefined } {
    return { message: this.message, stack: this.stack };
  }
}
// On the prototype, so a JobFailure has no own properties beyond message and stack.
JobFailure.prototype.name = "JobFailure";

export interface JobContext {
  jobId: string;
  attempt: number;
  createdOn: Temporal.Instant;
  logger: Logger;
  signal: AbortSignal;
}

/** What the wrapper reads from a pg-boss job (with metadata). */
type WorkJob = Pick<JobWithMetadata, "id" | "data" | "retryCount"> & {
  createdOn?: Date;
  signal?: AbortSignal;
};

function jobFailure(err: unknown): JobFailure {
  const s = sanitizeError(err);
  const message = s.key ?? s.code ?? s.class;
  const failure = new JobFailure(message);
  failure.stack = [`JobFailure: ${message}`, ...s.frames].join("\n    ");
  return failure;
}

/** A-297: one disposition per job (pg-boss `perJobResults`). */
export interface JobDisposition {
  id: string;
  status: "completed" | "failed" | "deadletter";
  output?: JobFailure;
}

export function wrapHandler<P>(
  def: JobDefinition<P>,
  handler: (payload: P, ctx: JobContext) => Promise<unknown>,
  deps: { logger: Logger; metrics: PlatformMetrics; reporter: ErrorReporter; clock: Clock },
): (jobs: WorkJob[]) => Promise<JobDisposition[]> {
  return async (jobs) => {
    const results: JobDisposition[] = [];
    for (const job of jobs) {
      // A-207: pg-boss counts retries from 0.
      const attempt = job.retryCount + 1;
      const started = deps.clock.now().epochMilliseconds;
      const record = (state: "completed" | "failed"): void => {
        const seconds = (deps.clock.now().epochMilliseconds - started) / 1000;
        deps.metrics.jobDuration.record(seconds, { queue: def.name });
        deps.metrics.jobsProcessed.add(1, { queue: def.name, job_state: state });
      };
      const parsed = def.payload.safeParse(job.data);
      if (!parsed.success) {
        // A-297: a planted row or a shape changed across a deploy; retrying can't fix either, so
        // the job goes straight to the role's dead-letter queue and the handler isn't called.
        const err = new JobPayloadInvalidError(parsed.error.issues);
        record("failed");
        deps.logger.warn("job_failed", {
          jobName: def.name,
          attempt,
          errorClass: "JobPayloadInvalidError",
          outcome: "dead_lettered",
        });
        deps.reporter.report(err, { jobName: def.name });
        deps.metrics.jobsDeadLettered.add(1, { queue: def.name });
        const output = new JobFailure("JobPayloadInvalidError");
        output.stack = "JobFailure: JobPayloadInvalidError";
        results.push({ id: job.id, status: "deadletter", output });
        continue;
      }
      try {
        await handler(parsed.data, {
          jobId: job.id,
          attempt,
          createdOn: Temporal.Instant.fromEpochMilliseconds(
            (job.createdOn ?? new Date(started)).getTime(),
          ),
          logger: deps.logger.child({ jobId: job.id, jobName: def.name, attempt }),
          signal: job.signal ?? new AbortController().signal,
        });
        // The return value is discarded: completed jobs store no output.
        record("completed");
        results.push({ id: job.id, status: "completed" });
      } catch (err) {
        record("failed");
        const s = sanitizeError(err);
        const { reason } = describeFailure(err);
        deps.logger.warn(
          "job_failed",
          {
            jobName: def.name,
            attempt,
            errorClass: s.class,
            ...(s.key !== undefined && ERROR_KEY.test(s.key) ? { errorKey: s.key } : {}),
            // A-298: the failure's reason and HTTP status, when it has them.
            ...(reason === undefined ? {} : { reason }),
            ...(s.status === undefined ? {} : { status: s.status }),
          },
          err,
        );
        if (!(err instanceof BudmonError)) {
          deps.reporter.report(err, { jobName: def.name });
        }
        if (attempt > def.retryLimit) {
          deps.metrics.jobsDeadLettered.add(1, { queue: def.name });
        }
        results.push({ id: job.id, status: "failed", output: jobFailure(err) });
      }
    }
    return results;
  };
}
