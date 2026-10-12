// F-184: flags migration statements that can lock, rewrite or lose data, unless reviewed.
// CLI: `tsx tools/checkRisky.ts <files…>` prints `file:line pattern` and exits 1 if any is flagged.
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BREAKPOINT = "--> statement-breakpoint";
const REVIEWED = /^--\s*reviewed:\s*(.+)$/;

const RULES: readonly { pattern: string; test: (sql: string) => boolean }[] = [
  { pattern: "DROP TABLE", test: (s) => /\bDROP\s+TABLE\b/i.test(s) },
  { pattern: "DROP COLUMN", test: (s) => /\bDROP\s+COLUMN\b/i.test(s) },
  { pattern: "RENAME", test: (s) => /\bRENAME\b/i.test(s) },
  {
    pattern: "ALTER COLUMN … TYPE",
    test: (s) => /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i.test(s),
  },
  { pattern: "SET NOT NULL", test: (s) => /\bSET\s+NOT\s+NULL\b/i.test(s) },
  {
    pattern: "ADD COLUMN … NOT NULL without DEFAULT",
    test: (s) =>
      /\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s),
  },
  {
    pattern: "ADD CONSTRAINT without NOT VALID",
    test: (s) =>
      /\bADD\s+CONSTRAINT\b[\s\S]*\b(CHECK|FOREIGN\s+KEY)\b/i.test(s) &&
      !/\bNOT\s+VALID\b/i.test(s),
  },
  { pattern: "CREATE UNIQUE INDEX", test: (s) => /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(s) },
  { pattern: "DROP INDEX", test: (s) => /\bDROP\s+INDEX\b/i.test(s) },
  { pattern: "TRUNCATE", test: (s) => /\bTRUNCATE\b/i.test(s) },
  { pattern: "DELETE FROM", test: (s) => /\bDELETE\s+FROM\b/i.test(s) },
];

export function checkRiskyStatements(sql: string): { line: number; pattern: string }[] {
  const flagged: { line: number; pattern: string }[] = [];
  let lineBase = 1;
  for (const segment of sql.split(BREAKPOINT)) {
    const lines = segment.split("\n");
    // A-363: the statement starts on its first line that isn't blank or a comment.
    const start = lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("--"));
    if (start >= 0) {
      const above = start > 0 ? (lines[start - 1] ?? "").trim() : "";
      const reason = REVIEWED.exec(above)?.[1]?.trim() ?? "";
      const statement = lines
        .slice(start)
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      const rule = RULES.find((r) => r.test(statement));
      if (rule !== undefined && reason.length < 10) {
        flagged.push({ line: lineBase + start, pattern: rule.pattern });
      }
    }
    lineBase += lines.length - 1;
  }
  return flagged;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const files = process.argv.slice(2);
  const cwd = process.env["INIT_CWD"] ?? process.cwd();
  let found = false;
  for (const file of files) {
    for (const f of checkRiskyStatements(readFileSync(path.resolve(cwd, file), "utf8"))) {
      process.stdout.write(`${file}:${String(f.line)} ${f.pattern}\n`);
      found = true;
    }
  }
  process.exitCode = found ? 1 : 0;
}
