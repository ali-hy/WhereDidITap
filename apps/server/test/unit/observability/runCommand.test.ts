// F-26 runCommand (A-89), the development commands' entry: `pnpm dev` runs through it. TP-2.39 (c),
// plus extra cases TP-2.77x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { runCommand } from "../../../src/platform/observability/describeFailure.js";

function recorder(): { lines: string[]; stderr: (line: string) => void } {
  const lines: string[] = [];
  return { lines, stderr: (line) => lines.push(line) };
}

describe("TP-2.39 (c): runCommand", () => {
  it("TP-2.39 (c): an Error with code ECONNRESET returns 1 and writes exactly one line, no stack", async () => {
    const out = recorder();
    const fn = (): Promise<number | undefined> =>
      Promise.reject(
        Object.assign(new Error("read ECONNRESET 127.0.0.1:5432"), { code: "ECONNRESET" }),
      );

    const code = await runCommand("pnpm dev", fn, out.stderr);

    expect(code).toBe(1);
    expect(out.lines).toEqual(["pnpm dev failed: Error ECONNRESET"]);
    expect(out.lines.join("\n")).not.toContain("    at ");
  });

  it("TP-2.39 (c): fn resolving undefined returns 0 and writes nothing", async () => {
    const out = recorder();

    const code = await runCommand("pnpm dev", () => Promise.resolve(undefined), out.stderr);

    expect(code).toBe(0);
    expect(out.lines).toEqual([]);
  });

  it("TP-2.39 (c): fn resolving 3 returns 3", async () => {
    const out = recorder();

    const code = await runCommand("pnpm dev", () => Promise.resolve(3), out.stderr);

    expect(code).toBe(3);
    expect(out.lines).toEqual([]);
  });
});

describe("TP-2.77x: runCommand, further cases (A-89)", () => {
  it("TP-2.77x: the line names the command it was given", async () => {
    const out = recorder();

    await runCommand("db:migrate", () => Promise.reject(new Error("m")), out.stderr);

    expect(out.lines).toEqual(["db:migrate failed: Error"]);
  });

  it("TP-2.77x: a reason comes after the code, in parentheses", async () => {
    const out = recorder();
    const { SchemaStepError } = await import("../../../src/platform/db/schemaStepError.js");

    const code = await runCommand(
      "db:migrate",
      () => Promise.reject(new SchemaStepError("invalid_verifier", "budmon_app")),
      out.stderr,
    );

    expect(code).toBe(1);
    expect(out.lines).toEqual(["db:migrate failed: SchemaStepError invalid_verifier (budmon_app)"]);
  });

  it("TP-2.77x: fn resolving 0 returns 0", async () => {
    const out = recorder();

    expect(await runCommand("pnpm dev", () => Promise.resolve(0), out.stderr)).toBe(0);
    expect(out.lines).toEqual([]);
  });

  it("TP-2.77x: the error's message never reaches stderr", async () => {
    const out = recorder();

    await runCommand("pnpm dev", () => Promise.reject(new Error("pw Qm3SECRET")), out.stderr);

    expect(out.lines.join("\n")).not.toContain("Qm3SECRET");
  });
});
