// TP-2.32: infra/compose.yaml pins every image by digest, and its Postgres image is the
// integration tests' POSTGRES_IMAGE (A-61, A-70). TP-15.31 checks the laptop's Compose files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { POSTGRES_IMAGE } from "../../../apps/server/test/setup/postgresImage.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DIGEST_PINNED = /^[^@]+@sha256:[0-9a-f]{64}$/;

function services(): [string, { image?: unknown }][] {
  const compose = parse(readFileSync(path.join(ROOT, "infra/compose.yaml"), "utf8")) as {
    services?: Record<string, { image?: unknown }>;
  };
  return Object.entries(compose.services ?? {});
}

function imageOf(service: { image?: unknown }): string {
  return typeof service.image === "string" ? service.image : "";
}

describe("TP-2.32: infra/compose.yaml images", () => {
  it("TP-2.32: every service's image is pinned by @sha256:<64 hex>", () => {
    const list = services();

    expect(list.length).toBeGreaterThan(0);
    expect(
      list
        .filter(([, s]) => !DIGEST_PINNED.test(imageOf(s)))
        .map(([name, s]) => `${name}: ${imageOf(s)}`),
    ).toEqual([]);
  });

  it("TP-2.32: the Postgres service's image equals POSTGRES_IMAGE", () => {
    const postgres = services().filter(([, s]) => imageOf(s).startsWith("postgres:"));

    expect(postgres.map(([, s]) => imageOf(s))).toEqual([POSTGRES_IMAGE]);
  });

  it("TP-2.32: a Mailpit service exists", () => {
    expect(services().some(([, s]) => /(^|\/)mailpit[:@]/.test(imageOf(s)))).toBe(true);
  });

  it("TP-2.32: POSTGRES_IMAGE itself is postgres 18 pinned by digest", () => {
    expect(POSTGRES_IMAGE).toMatch(/^postgres:18@sha256:[0-9a-f]{64}$/);
  });
});
