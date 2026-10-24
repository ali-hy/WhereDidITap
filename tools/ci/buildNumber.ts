// F-185 buildNumber: the web build number, the number of commits reachable from the release tag.
// CLI (A-7): `tsx buildNumber.ts <tag>` runs `git rev-list --count <tag>` in the working directory
// and prints the result.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function buildNumber(revCount: number): number {
  if (!Number.isInteger(revCount) || revCount <= 0) {
    throw new RangeError("the commit count must be a positive integer");
  }
  return revCount;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [tag, ...rest] = process.argv.slice(2);
  if (tag === undefined || rest.length > 0 || tag.startsWith("-")) {
    process.stderr.write("Usage: buildNumber.ts <tag>\n");
    process.exitCode = 64;
  } else {
    try {
      const count = execFileSync("git", ["rev-list", "--count", `${tag}^{commit}`, "--"], {
        encoding: "utf8",
      }).trim();
      process.stdout.write(`${String(buildNumber(Number(count)))}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "failed"}\n`);
      process.exitCode = 1;
    }
  }
}
