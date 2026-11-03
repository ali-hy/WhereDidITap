// F-7 checkEnvExample. TP-2.7, TP-2.30 (the committed .env.example against F-10's allConfigKeys,
// including DEV_SUPERUSER_URL, A-59, and HEARTBEAT_FILE, A-226), plus extra cases TP-2.57x.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allConfigKeys } from "../../../apps/server/src/platform/config/schema.js";
import { checkEnvExample } from "../checkEnvExample.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TP-2.7: checkEnvExample", () => {
  it("TP-2.7: keys [A, B] against A=1 lists B as missing", () => {
    expect(checkEnvExample(["A", "B"], "A=1")).toEqual({
      missingInExample: ["B"],
      unknownInExample: [],
    });
  });

  it("TP-2.7: keys [A, B] against A=1, B=2, C=3 lists C as unknown", () => {
    expect(checkEnvExample(["A", "B"], "A=1\nB=2\nC=3")).toEqual({
      missingInExample: [],
      unknownInExample: ["C"],
    });
  });

  it("TP-2.57x: comments and blank lines are ignored, and an empty value counts as present", () => {
    const example = "# Database\n\nA=1\n  # indented comment\nB=\n";

    expect(checkEnvExample(["A", "B"], example)).toEqual({
      missingInExample: [],
      unknownInExample: [],
    });
  });

  it("TP-2.30: the committed .env.example lists exactly F-10's variables", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

    expect(checkEnvExample(allConfigKeys(), example)).toEqual({
      missingInExample: [],
      unknownInExample: [],
    });
  });

  it("TP-2.30: allConfigKeys includes DEV_SUPERUSER_URL", () => {
    expect(allConfigKeys()).toContain("DEV_SUPERUSER_URL");
  });

  it("TP-2.30: (A-226) allConfigKeys includes HEARTBEAT_FILE, and .env.example leaves it empty", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

    expect(allConfigKeys()).toContain("HEARTBEAT_FILE");
    expect(example.split(/\r?\n/)).toContain("HEARTBEAT_FILE=");
  });

  it("TP-2.30: .env.example sets DEV_SUPERUSER_URL to the local superuser", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

    expect(example.split(/\r?\n/)).toContain(
      "DEV_SUPERUSER_URL=postgres://postgres:postgres@localhost:5432/postgres",
    );
  });

  it("TP-2.57x: allConfigKeys is sorted and includes the variables of every kind", () => {
    const keys = allConfigKeys();

    expect(keys).toEqual([...keys].sort());
    for (const key of [
      "APP_ENV",
      "DB_HOST",
      "ROLE_SECRETS_FILE",
      "WORKER_ROLES",
      "CURSOR_KEY_FILE",
      "SMTP_URL",
      "GOOGLE_SIGNIN_CLIENT_ID",
    ]) {
      expect(keys).toContain(key);
    }
  });
});
