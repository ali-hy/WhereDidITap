// F-345: the meta contract.
import { z } from "zod";
import { base } from "../common/errors.js";

export const ClientConfigSchema = z.object({
  apiVersion: z.string().regex(/^1\.\d+$/),
  android: z.object({
    minimumVersionCode: z.number().int().min(0),
    latestVersionCode: z.number().int().min(0),
    downloadUrl: z.url().nullable(),
  }),
  web: z.object({ minimumBuild: z.number().int().min(0) }),
});

export const metaContract = {
  clientConfig: base
    .route({ method: "GET", path: "/meta/client-config" })
    .output(ClientConfigSchema),
};
