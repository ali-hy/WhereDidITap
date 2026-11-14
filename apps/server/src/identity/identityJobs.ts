// F-33: identity's job definitions and their handlers. A definition joins `identityJobDefinitions`
// only in the slice that adds its handler (a registered job without one stops the workers).
import { UuidSchema } from "@budmon/contract";
import { z } from "zod";
import type { WorkerContainer } from "../platform/container.js";
import { defineJob, type JobDefinition } from "../platform/queue/jobs.js";
import type { JobHandler } from "../platform/queue/workers.js";
import { EMAIL_KINDS } from "./emailTemplates.js";
import { handleEmailSend, type EmailSendPayload } from "./emailJobService.js";

export const identityJobs = {
  emailSend: defineJob({
    name: "identity.email-send",
    role: "general",
    payload: z.object({
      kind: z.enum(EMAIL_KINDS),
      refId: UuidSchema,
      recipient: z.enum(["inviter", "owner"]).optional(),
    }),
    retryLimit: 5,
    retryDelaySeconds: 60,
    retryBackoff: true,
  }),
  exportBuild: defineJob({
    name: "identity.export-build",
    role: "general",
    payload: z.object({ exportId: UuidSchema }),
    retryLimit: 3,
    retryDelaySeconds: 60,
    retryBackoff: true,
    expireInSeconds: 1800,
  }),
  erasureSweep: defineJob({
    name: "identity.erasure-sweep",
    role: "general",
    payload: z.object({}),
    policy: "stately",
    retryLimit: 2,
    cron: "*/15 * * * *",
  }),
  eraseUser: defineJob({
    name: "identity.erase-user",
    role: "general",
    payload: z.object({ userId: UuidSchema, replay: z.boolean() }),
    policy: "stately",
    retryLimit: 10,
    retryDelaySeconds: 60,
    retryBackoff: true,
  }),
  purge: defineJob({
    name: "identity.purge",
    role: "general",
    payload: z.object({}),
    policy: "singleton",
    retryLimit: 2,
    cron: "5 * * * *",
  }),
};

/** S-0: only the email job is registered. */
export const identityJobDefinitions: readonly JobDefinition<unknown>[] = [identityJobs.emailSend];

/** One handler per registered definition. */
export function identityHandlers(c: WorkerContainer): [string, JobHandler][] {
  return [
    [
      identityJobs.emailSend.name,
      (payload, ctx) => handleEmailSend(c.identity.deps, payload as EmailSendPayload, ctx),
    ],
  ];
}
