// F-145: the development objects route, serving F-142's presigned URLs (development only).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Clock } from "@budmon/shared";
import type { FastifyInstance } from "fastify";
import { contentDisposition } from "../storage/objectStore.js";
import { objectPath, verifyObjectToken } from "../storage/fsObjectStore.js";

/** The platform's 404 envelope (as server.ts answers unknown routes). */
const NOT_FOUND = { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" };
const MAX_TOKEN_LENGTH = 2048;

export function registerDevObjectsRoute(
  app: FastifyInstance,
  deps: { root: string; signingKey: Buffer; clock: Clock },
): void {
  // A wildcard, not `:token`: tokens are longer than find-my-way's 100-character parameter limit.
  app.get<{ Params: { "*": string } }>("/dev/objects/*", async (request, reply) => {
    const token = request.params["*"];
    // A-304: refused before any decoding.
    if (token === "" || token.includes("/") || token.length > MAX_TOKEN_LENGTH) {
      return reply.code(404).send(NOT_FOUND);
    }
    const payload = verifyObjectToken(deps.signingKey, token, deps.clock.now());
    if (payload === null) return reply.code(404).send(NOT_FOUND);
    const file = objectPath(deps.root, payload.b, payload.k);
    const isFile = await stat(file).then(
      (st) => st.isFile(),
      () => false,
    );
    if (!isFile) return reply.code(404).send(NOT_FOUND);
    return reply
      .header("cache-control", "no-store")
      .header("content-disposition", contentDisposition(payload.n))
      .type("application/octet-stream")
      .send(createReadStream(file));
  });
}
