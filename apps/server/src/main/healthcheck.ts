// The healthcheck entry (F-175 "Health checks", A-208): `--heartbeat` for the workers, `--ready`
// for the api. Run as `node dist/main/healthcheck.js <flag>`; exit 0 healthy, 1 not.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { heartbeatFile } from "../platform/queue/heartbeat.js";

const MAX_AGE_SECONDS = 60;
const READY_TIMEOUT_MS = 2000;

/** F-79 writes epoch seconds; the content, not the mtime, is the beat (A-208). */
export function heartbeatHealthy(nowMs: number, read: () => string): boolean {
  let text: string;
  try {
    text = read().trim();
  } catch {
    return false;
  }
  if (!/^\d+$/.test(text)) return false;
  const beat = Number.parseInt(text, 10);
  return nowMs / 1000 - beat < MAX_AGE_SECONDS;
}

export async function readyHealthy(port: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });
    await res.arrayBuffer();
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function runHealthcheck(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (argv.includes("--heartbeat")) {
    // A-226: the same file the worker writes.
    const file = heartbeatFile(env);
    return heartbeatHealthy(Date.now(), () => readFileSync(file, "utf8")) ? 0 : 1;
  }
  if (argv.includes("--ready")) {
    const port = env["PORT"] === undefined || env["PORT"] === "" ? "3000" : env["PORT"];
    return (await readyHealthy(port)) ? 0 : 1;
  }
  process.stderr.write("usage: healthcheck --heartbeat | --ready\n");
  return 64;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runHealthcheck(process.argv.slice(2), process.env);
}
