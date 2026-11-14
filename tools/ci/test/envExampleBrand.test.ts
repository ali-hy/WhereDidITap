// P-A-513 (7), identity A-26: .env.example's From default carries the brand. TP-0b.10x. IDs ending
// in "x" are test-architect additions, not LLD test-plan IDs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TP-0b.10x: the From default", () => {
  it("TP-0b.10x: .env.example sets EMAIL_FROM=wDit <no-reply@budmon.local>", () => {
    const lines = readFileSync(path.join(ROOT, ".env.example"), "utf8").split(/\r?\n/);

    expect(lines.filter((l) => l.startsWith("EMAIL_FROM="))).toEqual([
      "EMAIL_FROM=wDit <no-reply@budmon.local>",
    ]);
  });
});
