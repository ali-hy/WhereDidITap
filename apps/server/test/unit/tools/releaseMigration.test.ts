// F-180 generateReleaseMigration with a fake pty. TP-14.1, plus extra cases TP-14.11x. IDs ending in
// "x" are test-architect additions, not LLD test-plan IDs.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PtyProcess, type SpawnPty, loadReleaseMigration } from "../../support/s14.js";

const QUESTION =
  "Is total_minor column in transactions table created or renamed from another column?";
const PROMPT = [
  `\u001b[1m${QUESTION}\u001b[22m`,
  "\u001b[36m❯\u001b[39m + total_minor          \u001b[2mcreate column\u001b[22m",
  "  ~ amount_minor › total_minor \u001b[2mrename column\u001b[22m",
  "",
].join("\r\n");

let serverDir: string;

beforeEach(() => {
  serverDir = mkdtempSync(path.join(tmpdir(), "budmon-f180-"));
  mkdirSync(path.join(serverDir, "drizzle"));
});
afterEach(() => {
  rmSync(serverDir, { recursive: true, force: true });
});

/**
 * A scripted PtyProcess (A-377): `script` runs when spawned, with helpers to emit output and exit.
 * Writes are recorded.
 */
function fakePty(
  script: (pty: {
    emit: (s: string) => void;
    exit: (code: number) => void;
    writes: string[];
  }) => unknown,
) {
  const writes: string[] = [];
  const killed = { value: false };
  let dataListener: (chunk: string) => void = () => undefined;
  let exitListener: (code: number) => void = () => undefined;
  const spawn = vi.fn<SpawnPty>(() => {
    const pty: PtyProcess = {
      onData: (cb) => {
        dataListener = cb;
      },
      onExit: (cb) => {
        exitListener = cb;
      },
      write: (d) => {
        writes.push(d);
      },
      kill: () => {
        killed.value = true;
      },
    };
    setTimeout(() => {
      script({
        emit: (s) => {
          dataListener(s);
        },
        exit: (code) => {
          exitListener(code);
        },
        writes,
      });
    }, 0);
    return pty;
  });
  return { spawn, writes, killed };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("TP-14.1: generateReleaseMigration (F-180)", () => {
  it('TP-14.1: a rename prompt gets "\\r" once and is listed in ambiguities; on success the new migration file is returned', async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn, writes } = fakePty(async ({ emit, exit }) => {
      emit("Reading config file\r\n");
      emit(PROMPT);
      await tick();
      writeFileSync(path.join(serverDir, "drizzle/0001_v1.2.0.sql"), "ALTER TABLE x;");
      emit("[✓] Your SQL migration file ➜ drizzle/0001_v1.2.0.sql 🚀\r\n");
      exit(0);
    });

    const result = await generateReleaseMigration(
      { version: "v1.2.0", serverDir },
      { spawnPty: spawn },
    );

    expect(writes).toEqual(["\r"]);
    expect(result.ambiguities).toHaveLength(1);
    expect(result.ambiguities[0]).toContain(QUESTION);
    expect(result.ambiguities[0]).not.toContain("\u001b");
    expect(result.file).not.toBeNull();
    expect(path.resolve(serverDir, result.file ?? "")).toBe(
      path.join(serverDir, "drizzle/0001_v1.2.0.sql"),
    );
  });

  it("TP-14.1 (A-362): the returned path is absolute and exists", async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn } = fakePty(({ emit, exit }) => {
      writeFileSync(path.join(serverDir, "drizzle/0001_v1.2.0.sql"), "ALTER TABLE x;");
      emit("[✓] Your SQL migration file ➜ drizzle/0001_v1.2.0.sql 🚀\r\n");
      exit(0);
    });

    const result = await generateReleaseMigration(
      { version: "v1.2.0", serverDir },
      { spawnPty: spawn },
    );

    expect(result.file).toBe(path.resolve(serverDir, "drizzle", "0001_v1.2.0.sql"));
    expect(path.isAbsolute(result.file ?? "")).toBe(true);
    expect(existsSync(result.file ?? "")).toBe(true);
  });

  it("TP-14.1: spawns pnpm exec drizzle-kit generate --name <version> in serverDir under an 80×24 pty", async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn } = fakePty(({ emit, exit }) => {
      emit("No schema changes, nothing to migrate 😴\r\n");
      exit(0);
    });

    await generateReleaseMigration({ version: "v1.2.0-hotfix.3", serverDir }, { spawnPty: spawn });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, options] = spawn.mock.calls[0] ?? [];
    expect(command).toBe("pnpm exec drizzle-kit generate --name v1.2.0-hotfix.3");
    expect(options).toEqual({ cwd: serverDir, cols: 80, rows: 24 });
  });

  it('TP-14.1: output "No schema changes" returns file null', async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn, writes } = fakePty(({ emit, exit }) => {
      emit("\u001b[1mNo schema changes\u001b[22m, nothing to migrate 😴\r\n");
      exit(0);
    });

    const result = await generateReleaseMigration(
      { version: "v1.2.0", serverDir },
      { spawnPty: spawn },
    );

    expect(result).toEqual({ file: null, ambiguities: [] });
    expect(writes).toEqual([]);
  });

  it('TP-14.1: a process that never exits is killed and rejects with "generate timed out"', async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn, killed } = fakePty(({ emit }) => {
      emit("Reading config file\r\n");
    });

    await expect(
      generateReleaseMigration(
        { version: "v1.2.0", serverDir, timeoutMs: 50 },
        { spawnPty: spawn },
      ),
    ).rejects.toThrow("generate timed out");
    expect(killed.value).toBe(true);
  });

  it.each([["1.0"], ["v1.2"], ["1.2.0"], ["v1.2.0-hotfix"], ["v1.2.0-rc.1"], ["v1.2.0 "]])(
    "TP-14.1: version %j is a validation error, before anything is spawned",
    async (version) => {
      const { generateReleaseMigration } = await loadReleaseMigration();
      const { spawn } = fakePty(({ exit }) => {
        exit(0);
      });

      await expect(
        generateReleaseMigration({ version, serverDir }, { spawnPty: spawn }),
      ).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('TP-14.11x: a non-zero exit rejects with "drizzle-kit generate failed"', async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const { spawn } = fakePty(({ emit, exit }) => {
      emit("Error: something broke\r\n");
      exit(2);
    });

    await expect(
      generateReleaseMigration({ version: "v1.2.0", serverDir }, { spawnPty: spawn }),
    ).rejects.toThrow("drizzle-kit generate failed");
  });

  it("TP-14.11x: two prompts in one run get two answers and two ambiguities", async () => {
    const { generateReleaseMigration } = await loadReleaseMigration();
    const second = "Is ledgers table created or renamed from another table?";
    const { spawn, writes } = fakePty(async ({ emit, exit }) => {
      emit(PROMPT);
      await tick();
      emit(`${second}\r\n❯ + ledgers   create table\r\n  ~ books › ledgers rename table\r\n`);
      await tick();
      writeFileSync(path.join(serverDir, "drizzle/0001_v1.2.0.sql"), "x");
      exit(0);
    });

    const result = await generateReleaseMigration(
      { version: "v1.2.0", serverDir },
      { spawnPty: spawn },
    );

    expect(writes).toEqual(["\r", "\r"]);
    expect(result.ambiguities).toHaveLength(2);
    expect(result.ambiguities[1]).toContain(second);
  });
});

// A-377: the real scriptPty (util-linux script(1)) gives the child a TTY and forwards writes.
describe("TP-14.1 (A-377): scriptPty", () => {
  it("TP-14.1: the child sees a TTY on stdin and receives a written line; exit 0", async () => {
    const { scriptPty } = await loadReleaseMigration();
    const pty = scriptPty(`bash -c '[ -t 0 ] && echo TTY; read x; echo got:$x'`, {
      cwd: serverDir,
      cols: 80,
      rows: 24,
    });
    let output = "";
    const exited = new Promise<number>((resolve) => {
      pty.onExit(resolve);
    });
    pty.onData((chunk) => {
      output += chunk;
    });

    pty.write("abc\r");
    const code = await Promise.race([
      exited,
      new Promise<never>((_r, reject) =>
        setTimeout(() => {
          pty.kill();
          reject(new Error(`scriptPty timed out; output: ${JSON.stringify(output)}`));
        }, 10_000),
      ),
    ]);

    expect(code).toBe(0);
    expect(output).toContain("TTY");
    expect(output).toContain("got:abc");
  }, 15_000);
});
