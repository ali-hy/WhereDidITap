// The healthcheck entry (F-175 "Health checks", S-6). TP-6.10's process part.
//
// It runs `src/main/healthcheck.ts` through tsx (the bundle is built once, by apiBundle.test.ts;
// a second build in parallel would race). `--heartbeat` reads HEARTBEAT_FILE (an absolute path,
// else /tmp/heartbeat, A-226) and judges its content (F-79's epoch seconds, A-208); `--ready`
// requests `http://127.0.0.1:${PORT}/health/ready`, so the stub API listens on a free port.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_DIR } from "../../support/platform.js";

const DEFAULT_HEARTBEAT = "/tmp/heartbeat";
const ENTRY = path.join(SERVER_DIR, "src/main/healthcheck.ts");
const TSX = path.join(SERVER_DIR, "node_modules/.bin/tsx");

/**
 * Runs the entry asynchronously: a blocking spawn would stop this process's stub API from
 * answering `--ready`.
 */
function healthcheck(
  arg: string,
  env: Record<string, string> = {},
  cwd: string = SERVER_DIR,
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [ENTRY, arg], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

/** Writes a heartbeat whose content is `ageSeconds` old, with an mtime `mtimeAgeSeconds` old. */
function beat(file: string, ageSeconds: number, mtimeAgeSeconds = ageSeconds): void {
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(file, String(now - ageSeconds));
  utimesSync(file, now - mtimeAgeSeconds, now - mtimeAgeSeconds);
}

describe("TP-6.10: healthcheck --heartbeat with HEARTBEAT_FILE (A-226)", () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "budmon-healthcheck-"));
    file = path.join(dir, "heartbeat");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const check = () => healthcheck("--heartbeat", { HEARTBEAT_FILE: file });

  it("TP-6.10: a fresh heartbeat exits 0", async () => {
    beat(file, 0);

    const { status, output } = await check();

    expect(status, output).toBe(0);
  });

  it("TP-6.10: a 61 s old heartbeat exits 1", async () => {
    beat(file, 61);

    const { status, output } = await check();

    expect(status, output).toBe(1);
  });

  it("TP-6.10: (A-208) content 'abc' exits 1", async () => {
    writeFileSync(file, "abc");

    const { status, output } = await check();

    expect(status, output).toBe(1);
  });

  it("TP-6.10: (A-208) a fresh timestamp in a file whose mtime is 2 minutes old exits 0 (the content decides)", async () => {
    beat(file, 0, 120);

    const { status, output } = await check();

    expect(status, output).toBe(0);
  });

  it("TP-6.10: (A-208) a 61 s old timestamp in a file whose mtime is now exits 1", async () => {
    beat(file, 61, 0);

    const { status, output } = await check();

    expect(status, output).toBe(1);
  });

  it("TP-6.10: no heartbeat file exits 1", async () => {
    rmSync(file, { force: true });

    const { status, output } = await check();

    expect(status, output).toBe(1);
  });
});

// The default path. Nothing else in the suite writes it now that every worker run has its own
// HEARTBEAT_FILE (A-226); its content is saved and restored around these cases.
describe("TP-6.10: a relative HEARTBEAT_FILE falls back to /tmp/heartbeat (A-226)", () => {
  let saved: string | undefined;
  let dir: string;

  beforeAll(() => {
    saved = existsSync(DEFAULT_HEARTBEAT) ? readFileSync(DEFAULT_HEARTBEAT, "utf8") : undefined;
    dir = mkdtempSync(path.join(tmpdir(), "budmon-healthcheck-rel-"));
    mkdirSync(path.join(dir, "rel"));
  });

  afterAll(() => {
    if (saved === undefined) rmSync(DEFAULT_HEARTBEAT, { force: true });
    else writeFileSync(DEFAULT_HEARTBEAT, saved);
    rmSync(dir, { recursive: true, force: true });
  });

  // Run from `dir`, where rel/hb exists: a relative path that was used would be found.
  const check = () => healthcheck("--heartbeat", { HEARTBEAT_FILE: "rel/hb" }, dir);

  it("TP-6.10: rel/hb is fresh but /tmp/heartbeat is 61 s old: exits 1 (the default is read)", async () => {
    beat(path.join(dir, "rel/hb"), 0);
    beat(DEFAULT_HEARTBEAT, 61);

    const { status, output } = await check();

    expect(status, output).toBe(1);
  });

  it("TP-6.10: rel/hb is 61 s old but /tmp/heartbeat is fresh: exits 0", async () => {
    beat(path.join(dir, "rel/hb"), 61);
    beat(DEFAULT_HEARTBEAT, 0);

    const { status, output } = await check();

    expect(status, output).toBe(0);
  });
});

describe("TP-6.10: healthcheck --ready (PORT, A-208)", () => {
  let server: Server;
  let port = 0;
  let status = 200;
  let readyRequests = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/health/ready") readyRequests += 1;
      res.writeHead(req.url === "/health/ready" ? status : 404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("TP-6.10: the API on PORT answering 200 exits 0", async () => {
    status = 200;
    readyRequests = 0;

    const { status: code, output } = await healthcheck("--ready", { PORT: String(port) });

    expect(code, output).toBe(0);
    expect(readyRequests).toBe(1);
  });

  it("TP-6.10: the API on PORT answering 503 exits 1, having asked /health/ready", async () => {
    status = 503;
    readyRequests = 0;

    const { status: code, output } = await healthcheck("--ready", { PORT: String(port) });

    // The stub answered 503: the exit isn't a timeout or a connection failure.
    expect(readyRequests).toBe(1);
    expect(code, output).toBe(1);
  });

  it("TP-6.10: (A-208) --ready uses PORT: with the stub answering 200 but PORT pointing elsewhere, it exits 1", async () => {
    status = 200;
    readyRequests = 0;
    const closed = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const a = probe.address();
        const p = typeof a === "object" && a !== null ? a.port : 0;
        probe.close(() => {
          resolve(p);
        });
      });
    });

    const { status: code, output } = await healthcheck("--ready", { PORT: String(closed) });

    expect(code, output).toBe(1);
    expect(readyRequests).toBe(0);
  });
});
