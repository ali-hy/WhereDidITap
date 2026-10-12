// F-122 installProxySupport. TP-8.14: a local HTTPS target and a CONNECT proxy that records the
// hosts it's asked for; each case runs a child process (fixture proxyChild.ts) that calls
// installProxySupport and then fetch.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";

const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");
const CHILD = path.join(SERVER_DIR, "test/fixtures/processes/proxyChild.ts");

let dir: string;
let target: HttpsServer;
let targetPort: number;
let proxy: Server;
let proxyPort: number;
const connects: string[] = [];
const sockets: Socket[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "budmon-proxy-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-days",
      "1",
      "-keyout",
      path.join(dir, "key.pem"),
      "-out",
      path.join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  target = createHttpsServer(
    {
      key: readFileSync(path.join(dir, "key.pem")),
      cert: readFileSync(path.join(dir, "cert.pem")),
    },
    (_req, res) => {
      res.writeHead(204);
      res.end();
    },
  );
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const t = target.address();
  targetPort = typeof t === "object" && t !== null ? t.port : 0;

  proxy = createHttpServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on("connect", (req, client: Socket, head: Buffer) => {
    connects.push(req.url ?? "");
    const [host = "", port = "443"] = (req.url ?? "").split(":");
    const upstream = connect(Number(port), host === "localhost" ? "127.0.0.1" : host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.push(client, upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const p = proxy.address();
  proxyPort = typeof p === "object" && p !== null ? p.port : 0;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise<void>((resolve) => {
    proxy.close(() => {
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    target.close(() => {
      resolve();
    });
  });
  rmSync(dir, { recursive: true, force: true });
});

function child(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(TSX, [CHILD], {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env["PATH"] ?? "",
        NODE_EXTRA_CA_CERTS: path.join(dir, "cert.pem"),
        TARGET_URL: `https://localhost:${String(targetPort)}/`,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout.on("data", (c: Buffer) => (output += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (output += c.toString()));
    proc.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

describe("TP-8.14: proxy wiring (F-122)", () => {
  it("TP-8.14 (a): with HTTPS_PROXY set, the proxy sees a CONNECT to the target and the request succeeds", async () => {
    connects.length = 0;

    const { code, output } = await child({ HTTPS_PROXY: `http://127.0.0.1:${String(proxyPort)}` });

    expect(code, output).toBe(0);
    expect(output).toContain('{"status":204}');
    expect(connects).toContain(`localhost:${String(targetPort)}`);
  });

  it("TP-8.14 (b): with NO_PROXY including the target, no CONNECT and the request succeeds", async () => {
    connects.length = 0;

    const { code, output } = await child({
      HTTPS_PROXY: `http://127.0.0.1:${String(proxyPort)}`,
      NO_PROXY: "localhost",
    });

    expect(code, output).toBe(0);
    expect(output).toContain('{"status":204}');
    expect(connects).toEqual([]);
  });

  it("TP-8.14 (c): with no proxy variable, no CONNECT and the request succeeds directly", async () => {
    connects.length = 0;

    const { code, output } = await child({});

    expect(code, output).toBe(0);
    expect(output).toContain('{"status":204}');
    expect(connects).toEqual([]);
  });
});
