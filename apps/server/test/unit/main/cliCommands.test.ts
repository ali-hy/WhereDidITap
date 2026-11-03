// A-502 (10): every command in F-93's first table is dispatched by runCli, so a command the LLD
// defines can't be missing from cli.ts unnoticed (QA Q-F2). The table is read from the LLD itself:
// one command per row, the command words first in the first cell's code span. Commands other
// modules register (identity's, below that table) are tested by their own module. TP-15.55.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/main/cli.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const LLD = path.join(ROOT, "docs/design/platform/lld.md");
const HEADER = /^\s*\|\s*Command\s*\|\s*Calls\s*\|\s*Output\s*\|\s*Exit\s*\|\s*$/;

/** The command words of each row of the first table after `#### F-93`. */
function f93Commands(): string[][] {
  const lines = readFileSync(LLD, "utf8").split("\n");
  const heading = lines.findIndex((l) => l.startsWith("#### F-93"));
  expect(heading, "#### F-93 heading").toBeGreaterThanOrEqual(0);
  const header = lines.findIndex((l, i) => i > heading && HEADER.test(l));
  expect(header, "F-93's command table header").toBeGreaterThan(heading);
  const commands: string[][] = [];
  // Skip the header and its separator row; the table ends at the first line that isn't a row.
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    const firstCell =
      line
        .trim()
        .slice(1)
        .split(/(?<!\\)\|/)[0] ?? "";
    const span = /`([^`]+)`/.exec(firstCell)?.[1];
    if (span === undefined) continue;
    const words: string[] = [];
    for (const word of span.split(/\s+/)) {
      if (word === "" || /^[-[<]/.test(word)) break;
      words.push(word);
    }
    commands.push(words);
  }
  return commands;
}

async function cli(argv: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await Promise.race([
    runCli(argv, {}, { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) }),
    new Promise<"timeout">((resolve) => {
      setTimeout(() => {
        resolve("timeout");
      }, 10_000);
    }),
  ]);
  return { code, stdout, stderr };
}

describe("TP-15.55: every F-93 command is dispatched by runCli (A-502 (10))", () => {
  const commands = f93Commands();

  it("TP-15.55: the parsed table lists at least F-93's eight platform commands", () => {
    expect(commands.map((w) => w.join(" "))).toEqual(
      expect.arrayContaining([
        "jobs:dead list",
        "jobs:dead redrive",
        "secrets:rewrap-api",
        "restore:verify",
        "erasure:replay",
        "jobs:capture-rewrap",
        "fx:backfill",
        "diagnostics:sentry-test",
      ]),
    );
  });

  it.each(commands.map((w) => [w.join(" "), w] as const))(
    "TP-15.55: %s settles within 10 s and isn't an unknown command",
    async (_label, words) => {
      const r = await cli(words);

      expect(r.code, "settled within 10 s").not.toBe("timeout");
      expect(r.stderr.filter((l) => l.startsWith("Unknown command:"))).toEqual([]);
    },
    15_000,
  );

  it("TP-15.55: the control, nope:nope, exits 64 with Unknown command: nope:nope", async () => {
    const r = await cli(["nope:nope"]);

    expect(r.code).toBe(64);
    expect(r.stderr.some((l) => l.startsWith("Unknown command: nope:nope"))).toBe(true);
  });
});
