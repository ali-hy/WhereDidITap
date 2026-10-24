// A-476: the rehearsal's child processes. Each child's stdout and stderr go to its step's log
// file under <workDir>/artifacts/steps (scanned and withheld on a hit by collectArtifacts), never
// to the job log; arguments, environment and stdin are never written anywhere.
import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Exec } from "./run.js";

export function createLoggingExec(logDir: string, deps: { spawn?: typeof nodeSpawn } = {}): Exec {
  const spawn = deps.spawn ?? nodeSpawn;
  return (cmd, args, o) =>
    new Promise((resolve) => {
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
      chmodSync(logDir, 0o700);
      const file = path.join(logDir, `${o.step.replaceAll("/", "--")}.log`);
      const write = (text: string) => {
        appendFileSync(file, text, { mode: 0o600 });
      };
      let stdout = "";
      let stderr = "";
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        write(`### ${path.basename(cmd)} (step ${o.step})\n`);
        write(o.sensitiveStdout === true ? "[stdout withheld]\n" : stdout);
        write("\n--- stderr\n");
        write(stderr);
        write(`\n### exit ${String(code)}\n`);
        resolve({ code, stdout });
      };
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawn(cmd, args, {
          ...(o.cwd === undefined ? {} : { cwd: o.cwd }),
          env: { ...process.env, ...o.env },
          stdio: ["pipe", "pipe", "pipe"],
          ...(o.timeoutMs === undefined ? {} : { timeout: o.timeoutMs }),
        });
      } catch {
        finish(127);
        return;
      }
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (stdout += chunk));
      child.stderr?.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", () => {
        finish(127);
      });
      child.on("close", (code) => {
        finish(code ?? 1);
      });
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(o.input);
    });
}
