// The KMS client for F-112, created on first use (the gRPC stack loads only in worker-capture).
// The endpoint is the allowlisted host explicitly (F-121).
import type { KmsDecryptClient } from "./captureUnsealer.js";

export function lazyKmsClient(credentials: object): KmsDecryptClient {
  let client: Promise<KmsDecryptClient> | undefined;
  const get = (): Promise<KmsDecryptClient> => {
    client ??= import("@google-cloud/kms").then(
      ({ KeyManagementServiceClient }) =>
        new KeyManagementServiceClient({
          credentials: credentials as never,
          apiEndpoint: "cloudkms.googleapis.com",
        }) as unknown as KmsDecryptClient,
    );
    return client;
  };
  return {
    asymmetricDecrypt: async (request, options) =>
      (await get()).asymmetricDecrypt(request, options),
  };
}
