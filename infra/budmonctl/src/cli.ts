// budmonctl, the owner-side CLI (S-15). Stage 0 has one command:
//   budmonctl secrets init-local --home <dir>    (F-191)
// Exit 0 ok, 2 secrets already exist, 64 usage.
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { initLocalSecrets, SecretsExistError } from "./localSecrets.js";

const USAGE = "Usage: budmonctl secrets init-local --home <dir>";

export async function runCli(
  argv: readonly string[],
  io: { stdout: (line: string) => void; stderr: (line: string) => void },
): Promise<number> {
  const [group, command, flag, home, ...rest] = argv;
  if (
    group !== "secrets" ||
    command !== "init-local" ||
    flag !== "--home" ||
    home === undefined ||
    home === "" ||
    rest.length > 0
  ) {
    io.stderr(USAGE);
    return 64;
  }
  try {
    const { files } = await initLocalSecrets(
      { budmonHome: home },
      {
        randomBytes,
        mkdir: async (p, mode) => {
          await mkdir(p, { mode });
          await chmod(p, mode);
        },
        writeFile: async (p, data, mode) => {
          await writeFile(p, data, { mode, flag: "wx" });
          await chmod(p, mode);
        },
        exists: async (p) => {
          try {
            await access(p);
            return true;
          } catch {
            return false;
          }
        },
      },
    );
    for (const f of files) io.stdout(f);
    return 0;
  } catch (error) {
    if (error instanceof SecretsExistError) {
      io.stderr(`budmonctl: ${home}/secrets already exists`);
      return 2;
    }
    throw error;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  });
}
