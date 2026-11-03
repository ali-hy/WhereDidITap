// A local HTTP server standing in for Sentry (the "Sentry test transport" of TP-3.6 and TP-3.10).
// A DSN pointing at it makes the real Sentry client send its envelopes here, so a test reads
// exactly what would leave the process. Owned by the test-architect.
import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";

export interface FakeSentry {
  dsn: string;
  /** Every envelope body received, decompressed. */
  bodies: string[];
  close(): Promise<void>;
}

export async function startFakeSentry(): Promise<FakeSentry> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
      bodies.push(body.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    dsn: `http://publickey@127.0.0.1:${String(port)}/1`,
    bodies,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The event items of every envelope received (an envelope is newline-delimited JSON). */
export function sentryEvents(bodies: readonly string[]): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const body of bodies) {
    const lines = body.split("\n").filter((l) => l !== "");
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i] ?? "{}") as { type?: string };
      if (header.type === "event") {
        events.push(JSON.parse(lines[i + 1] ?? "{}") as Record<string, unknown>);
      }
    }
  }
  return events;
}
