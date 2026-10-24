// F-55's frameworkErrors and clientErrorHandler (A-178, A-183, A-184). TP-4.30.
//
// The API runs in-process with captured logs and metrics, listening on a real port: these errors
// happen before or outside Fastify's routing, so the client is a raw TCP socket.
import { createConnection, type Socket } from "node:net";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../../../src/platform/http/server.js";
import { SECURITY_HEADERS } from "../../../src/platform/security/headers.js";
import {
  buildApiContainer,
  observed,
  type BuiltContainer,
  type Observed,
} from "../../support/api.js";

let built: BuiltContainer;
let app: FastifyInstance;
let obs: Observed;
let port: number;

beforeAll(async () => {
  obs = observed();
  built = await buildApiContainer(obs.overrides);
  app = await createApiServer(built.container);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
});

afterAll(async () => {
  await app.close();
  await built.close();
});

interface RawResponse {
  raw: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

function parse(raw: string): RawResponse {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const [statusLine = "", ...lines] = head.split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { raw, status: Number(statusLine.split(" ")[1] ?? 0), headers, body };
}

/** Writes `text` over a raw socket; resolves with what came back once the server closes. */
function rawHttp(text: string): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    let received = "";
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(text);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("close", () => {
      resolve(parse(received));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      // The server may close while we're still writing an oversized request.
      if (error.code === "EPIPE" || error.code === "ECONNRESET") return;
      reject(error);
    });
  });
}

/** The current value of a counter's point whose attributes include `attributes`. */
async function counter(name: string, attributes: Record<string, string>): Promise<number> {
  const metric = (await obs.collect()).get(name);
  const point = metric?.dataPoints.find((p) =>
    Object.entries(attributes).every(([k, v]) => p.attributes[k] === v),
  );
  return typeof point?.value === "number" ? point.value : 0;
}

/** The sum of every point of a counter. */
async function total(name: string): Promise<number> {
  const metric = (await obs.collect()).get(name);
  return (metric?.dataPoints ?? []).reduce(
    (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
    0,
  );
}

describe("TP-4.30: a bad percent-encoding gets the platform envelope (A-178, A-183)", () => {
  it("TP-4.30: GET /api/v1/%zz?t=<canary> is 400 invalid_url with F-61's headers, X-Request-Id, one /unmatched log line, metrics, no canary", async () => {
    const linesBefore = obs.capture.records().length;
    const requestsBefore = await counter("http_server_requests_total", {
      http_route: "/unmatched",
      status_class: "4xx",
    });

    const res = await rawHttp(
      `GET /api/v1/%zz?t=${CANARIES.token} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
    );

    expect(res.status, res.raw).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      defined: true,
      code: "VALIDATION_FAILED",
      status: 400,
      message: "Validation failed",
      data: { issues: [{ path: [], code: "invalid_url", message: "Request URL is not valid." }] },
    });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name], name).toBe(value);
    }
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);
    const lines = obs.capture
      .records()
      .slice(linesBefore)
      .filter((l) => l["event"] === "http_request");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "/unmatched", status: 400 });
    expect(
      scanForCanaries(
        [
          { name: "response", text: res.raw },
          { name: "log", text: obs.capture.text() },
        ],
        CANARIES,
      ),
    ).toEqual([]);
    expect(res.raw).not.toContain("%zz");
    // A-183: recorded like any request.
    expect(
      await counter("http_server_requests_total", {
        http_route: "/unmatched",
        status_class: "4xx",
      }),
    ).toBe(requestsBefore + 1);
  });
});

describe("TP-4.30: connection-level errors get fixed bodiless replies (A-178, A-184)", () => {
  function expectBodiless(res: RawResponse, status: number): void {
    expect(res.status, res.raw).toBe(status);
    expect(res.headers["content-length"]).toBe("0");
    expect(res.headers["connection"]).toBe("close");
    expect(res.body).toBe("");
    expect(scanForCanaries([{ name: "response", text: res.raw }], CANARIES)).toEqual([]);
  }

  it("TP-4.30: 64 KiB of headers holding a canary is a raw 431, headers_too_large +1", async () => {
    const before = await counter("http_client_errors_total", { reason: "headers_too_large" });
    const big = `${CANARIES.token}-`.repeat(Math.ceil(65536 / (CANARIES.token.length + 1)));

    const res = await rawHttp(
      `GET /api/v1/meta/client-config HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Big: ${big}\r\n\r\n`,
    );

    expectBodiless(res, 431);
    expect(await counter("http_client_errors_total", { reason: "headers_too_large" })).toBe(
      before + 1,
    );
  });

  it("TP-4.30: a request line that doesn't parse is a raw 400, bad_request +1", async () => {
    const before = await counter("http_client_errors_total", { reason: "bad_request" });

    const res = await rawHttp(`NOT HTTP ${CANARIES.payee}\r\n\r\n`);

    expectBodiless(res, 400);
    expect(await counter("http_client_errors_total", { reason: "bad_request" })).toBe(before + 1);
  });

  it("TP-4.30: a request timeout (ERR_HTTP_REQUEST_TIMEOUT) is a raw 408, timeout +1", async () => {
    // Node checks request timeouts every 30 s, so the server socket gets Node's own error directly.
    const before = await counter("http_client_errors_total", { reason: "timeout" });
    const serverSide = new Promise<Socket>((resolve) => {
      app.server.once("connection", resolve);
    });
    const pending = rawHttp("GET /api/v1/meta/client-config HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    const socket = await serverSide;

    app.server.emit(
      "clientError",
      Object.assign(new Error("Request timeout"), { code: "ERR_HTTP_REQUEST_TIMEOUT" }),
      socket,
    );
    const res = await pending;

    expectBodiless(res, 408);
    expect(await counter("http_client_errors_total", { reason: "timeout" })).toBe(before + 1);
  });

  it("TP-4.30: a client that resets mid-headers gets nothing written and changes no counter", async () => {
    const before = await total("http_client_errors_total");
    let received = "";

    await new Promise<void>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port }, () => {
        socket.write(`GET /api/v1/meta/client-config HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Partial: ab`);
        setTimeout(() => {
          socket.resetAndDestroy();
          resolve();
        }, 100);
      });
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (received += chunk));
      socket.on("error", () => undefined);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(received).toBe("");
    expect(await total("http_client_errors_total")).toBe(before);
    // The server is unaffected.
    const after = await rawHttp(
      "GET /api/v1/meta/client-config HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );
    expect(after.status).toBe(200);
  });
});
