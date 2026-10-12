// TP-2.40 (A-85): the README's S-2 sections. S-2 owns `## Prerequisites`, `## First run`,
// `## Configuration`, `## Database commands`, `## Tests` and `## Layout`; later slices extend them
// (S-4, S-11a/b, S-13, S-14, S-15), so this test checks what S-2 puts in them and nothing else.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const README = readFileSync(path.join(ROOT, "README.md"), "utf8");

const HEADINGS = [
  "Prerequisites",
  "First run",
  "Configuration",
  "Database commands",
  "Tests",
  "Layout",
] as const;

function headings(): string[] {
  return [...README.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1] ?? "");
}

/** The text under `## <name>`, up to the next `## ` heading. */
function section(name: string): string {
  const lines = README.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Mailpit's inbox (container port 8025) as published by infra/compose.yaml. */
function mailpitInboxPort(): string {
  const compose = parse(readFileSync(path.join(ROOT, "infra/compose.yaml"), "utf8")) as {
    services?: Record<string, { ports?: unknown[] }>;
  };
  const ports = (compose.services?.["mailpit"]?.ports ?? []).map(String);
  const inbox = ports.find((p) => p.endsWith(":8025"));
  const hostPort = inbox?.split(":").at(-2);
  if (hostPort === undefined) throw new Error("infra/compose.yaml publishes no Mailpit inbox port");
  return hostPort;
}

describe("TP-2.40: README (A-85)", () => {
  it.each(HEADINGS.map((h) => [h]))("TP-2.40: has the heading ## %s", (heading) => {
    expect(headings()).toContain(heading);
  });

  it.each([
    ["pnpm dev"],
    [".env"],
    [".data/dev-secrets"],
    ["db:reset"],
    ["db:seed"],
    ["db:migrate"],
    ["Mailpit"],
    ["Node 24"],
  ])("TP-2.40: mentions %s", (text) => {
    expect(README).toContain(text);
  });

  it("TP-2.40: doesn't say Docker is only for tests", () => {
    const sentences = README.split(/(?<=[.!?])\s+|\n\s*\n|\n- /);
    const onlyForTests = sentences.filter(
      (s) => /docker/i.test(s) && /\bonly\b/i.test(s) && /\btests?\b/i.test(s),
    );

    expect(onlyForTests).toEqual([]);
  });

  it("TP-2.40: doesn't advise -- before db:* flags (A-95)", () => {
    expect(README).not.toMatch(/db:[a-z]+\s+--\s/);
    expect(README).not.toMatch(/`--`/);
  });

  it("TP-2.40: ## Database commands shows pnpm db:reset --no-seed (A-95)", () => {
    expect(section("Database commands")).toContain("pnpm db:reset --no-seed");
  });

  it("TP-2.40: ## Prerequisites names Docker for the development stack and the integration tests, Node 24 from .nvmrc and pnpm through Corepack", () => {
    const text = section("Prerequisites");
    const dockerLines = text.split("\n- ").filter((item) => /docker/i.test(item));

    expect(dockerLines.some((item) => /development/i.test(item) && /tests?\b/i.test(item))).toBe(
      true,
    );
    expect(text).toContain("24");
    expect(text).toContain(".nvmrc");
    expect(text).toContain("Corepack");
  });

  it("TP-2.40: ## First run covers pnpm install, pnpm dev, .env.example, .data/dev-secrets, Postgres, Mailpit, Ctrl-C and Mailpit's inbox port", () => {
    const text = section("First run");

    for (const needle of [
      "pnpm install",
      "pnpm dev",
      ".env.example",
      ".data/dev-secrets",
      "Postgres",
      "Mailpit",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).toMatch(/Ctrl[-+]C/i);
    expect(text).toContain(mailpitInboxPort());
  });

  it("TP-2.40: ## Configuration names .env and .data and says api.ts isn't run directly", () => {
    const text = section("Configuration");

    expect(text).toContain(".env");
    expect(text).toContain(".data");
    expect(text).toContain("api.ts");
  });

  it("TP-2.40: ## Database commands lists db:reset, db:seed and db:migrate, and that migrations exist only on release branches", () => {
    const text = section("Database commands");

    for (const command of ["db:reset", "db:seed", "db:migrate"]) {
      expect(text, command).toContain(command);
    }
    expect(text).toMatch(/release/i);
  });

  it("TP-2.40: ## Tests lists test, test:int (Docker), test:coverage and check", () => {
    const text = section("Tests");

    for (const command of ["pnpm test", "test:int", "test:coverage", "check"]) {
      expect(text, command).toContain(command);
    }
    expect(text).toMatch(/docker/i);
  });
});
