// F-58: meta.clientConfig, never blocked by the client version check.
import { API_VERSION } from "@budmon/contract";
import { publicProcedure } from "./procedures.js";

export const metaRouter = {
  clientConfig: publicProcedure.meta.clientConfig.handler(({ context }) => {
    const api = context.container.config.api;
    const versions = api?.clientVersions;
    return {
      apiVersion: API_VERSION,
      android: {
        minimumVersionCode: versions?.minAndroid ?? 0,
        latestVersionCode: versions?.latestAndroid ?? 0,
        downloadUrl: versions?.androidDownloadUrl?.toString() ?? null,
      },
      web: { minimumBuild: versions?.minWeb ?? 0 },
    };
  }),
};
