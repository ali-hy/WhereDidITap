// HTTP helpers for identity's procedure tests (identity LLD §5), owned by the test-architect.
//
// - call(app, method, path, body?, opts): Fastify inject on /api/v1<path> with a client header, a
//   host and a remote address (unique per call unless given, so F-29's per-IP limits and the
//   coarse limit never couple tests).
// - errorOf(res): the P-§5.1 error envelope of a response.
import type { FastifyInstance } from "fastify";
import type { InjectedResponse } from "./api.js";

let ipSequence = 0;

/** A fresh 10.x.y.z address. */
export function nextIp(): string {
  ipSequence += 1;
  const n = ipSequence;
  return `10.${String(200 + (n >> 16))}.${String((n >> 8) & 255)}.${String(n & 255 || 1)}`;
}

export const TAILNET = "x.ts.net";

export interface CallOptions {
  /** X-Budmon-Client; default "android/1". */
  client?: string;
  /** Host; default TAILNET. */
  host?: string;
  /** Remote address; default a fresh one. */
  ip?: string;
  headers?: Record<string, string>;
}

export async function call(
  app: FastifyInstance,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<InjectedResponse> {
  const headers: Record<string, string> = {
    host: opts.host ?? TAILNET,
    "x-budmon-client": opts.client ?? "android/1",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...opts.headers,
  };
  const response = await app.inject({
    method,
    url: `/api/v1${path}`,
    headers,
    remoteAddress: opts.ip ?? nextIp(),
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    body: response.body,
    json: () => JSON.parse(response.body) as unknown,
  };
}

export interface ErrorEnvelope {
  defined: boolean;
  code: string;
  status: number;
  message: string;
  data?: unknown;
}

/** The response's error envelope (P-§5.1). */
export function errorOf(res: InjectedResponse): ErrorEnvelope {
  return res.json() as ErrorEnvelope;
}
