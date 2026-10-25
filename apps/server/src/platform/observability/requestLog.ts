// F-38: one log line and two metrics per HTTP request. The Fastify server arrives with S-4; this
// takes the small part of FastifyInstance it uses.
import type { ClientKind } from "../http/context.js";
import type { Logger } from "./logger.js";
import type { PlatformMetrics } from "./metrics.js";

export interface RequestLogRequest {
  method: string;
  url: string;
  routeOptions?: { url?: string };
  orpcRoute?: string;
  requestId?: string;
  userId?: string;
  clientKind?: string;
  clientVersion?: number | null;
}

export interface RequestLogReply {
  statusCode: number;
  elapsedTime: number;
}

export interface RequestLogApp {
  addHook(
    name: "onResponse",
    hook: (request: RequestLogRequest, reply: RequestLogReply) => Promise<void>,
  ): unknown;
}

interface RequestRecord {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  clientKind: string;
  clientVersion?: number | null;
  requestId?: string;
  userId?: string;
}

type RequestLogDeps = { logger: Logger; metrics: PlatformMetrics };

function writeRequest(deps: RequestLogDeps, record: RequestRecord): void {
  const { method, route, status, durationMs, clientKind } = record;
  const statusClass = `${String(Math.floor(status / 100))}xx`;
  const fields = {
    method,
    route,
    status,
    statusClass,
    durationMs,
    clientKind,
    ...(record.clientVersion === null || record.clientVersion === undefined
      ? {}
      : { clientVersion: record.clientVersion }),
    ...(record.requestId === undefined ? {} : { requestId: record.requestId }),
    ...(record.userId === undefined ? {} : { userId: record.userId }),
  };
  if (route === "/health/live" || route === "/health/ready") {
    deps.logger.debug("http_request", fields);
  } else {
    deps.logger.info("http_request", fields);
  }
  deps.metrics.httpServerRequests.add(1, {
    http_route: route,
    method,
    status_class: statusClass,
    client_kind: clientKind,
  });
  deps.metrics.httpServerDuration.record(durationMs / 1000, { http_route: route, method });
}

/** A-183: the log line, `http_server_requests_total` and `http_server_duration_seconds` for one
 * request; F-38's hook and F-55's `frameworkErrors` both record through it. */
export function recordRequest(
  deps: RequestLogDeps,
  fields: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
    clientKind: ClientKind;
    clientVersion: number | null;
    requestId: string;
    userId?: string;
  },
): void {
  writeRequest(deps, fields);
}

export function registerRequestLog(app: RequestLogApp, deps: RequestLogDeps): void {
  app.addHook("onResponse", (request, reply) => {
    writeRequest(deps, {
      method: request.method,
      route: request.orpcRoute ?? request.routeOptions?.url ?? "/unmatched",
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
      clientKind: request.clientKind ?? "other",
      ...(request.clientVersion === undefined ? {} : { clientVersion: request.clientVersion }),
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userId === undefined ? {} : { userId: request.userId }),
    });
    return Promise.resolve();
  });
}
