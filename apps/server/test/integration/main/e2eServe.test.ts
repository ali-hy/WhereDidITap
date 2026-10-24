// F-222 e2e:serve start-up failure (review B-8): when `vite preview` can't bind its port
// (--strictPort), the script prints "e2e:serve failed: <errorClass>" and exits 1, rather than
// leaving Playwright to time out. Extra case TP-11.35x (IDs ending in "x" are test-architect
// additions). Runs the real script: Postgres container, API, worker and web build first.
import { spawn } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";

/** A port that's free now, held by `server` until closed. */
function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}

let squatter: Server;
/** e2e:serve's readiness polls connect to the squatter; they're dropped on close. */
const sockets = new Set<Socket>();
let webPort = 0;
let apiPort = 0;

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

beforeAll(async () => {
  squatter = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  webPort = await listen(squatter);
  const probe = createServer();
  apiPort = await listen(probe);
  await close(probe);
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await close(squatter);
});

describe("TP-11.35x (B-8): e2e:serve when the preview can't start", () => {
  it("TP-11.35x: the web port taken: e2e:serve failed: <errorClass> on stderr and exit 1", async () => {
    const child = spawn(path.join(SERVER_DIR, "node_modules/.bin/tsx"), ["scripts/e2eServe.ts"], {
      cwd: SERVER_DIR,
      env: { ...process.env, E2E_WEB_PORT: String(webPort), E2E_API_PORT: String(apiPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.resume();

    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(null);
      }, 540_000);
      child.on("exit", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });

    expect(code, stderr).toBe(1);
    expect(stderr).toMatch(/^e2e:serve failed: \S+$/m);
  }, 600_000);
});
