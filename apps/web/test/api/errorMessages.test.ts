// F-203 messageForError: every row of the HLD §4.9 table. TP-11.3.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AppError, type Operation, loadErrorMessages } from "../support/s11b.js";

const EN = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/i18n/messages/en.json"),
    "utf8",
  ),
) as Record<string, string>;

const defined = (key: string, status: number, data?: unknown): AppError => ({
  kind: "defined",
  key,
  status,
  data,
});

const ROWS: readonly (readonly [string, AppError, Operation, string, Record<string, number>?])[] = [
  [
    "INTERNAL not_applied on a create",
    defined("INTERNAL", 500, { outcome: "not_applied" }),
    "create",
    "error.generic.notChanged",
  ],
  [
    "INTERNAL not_applied on a mutation",
    defined("INTERNAL", 500, { outcome: "not_applied" }),
    "mutation",
    "error.generic.notChanged",
  ],
  [
    "INTERNAL unknown on a create",
    defined("INTERNAL", 500, { outcome: "unknown" }),
    "create",
    "error.generic.unknownOutcome",
  ],
  ["timeout on a create", { kind: "timeout" }, "create", "error.generic.unknownOutcome"],
  ["timeout on a mutation", { kind: "timeout" }, "mutation", "error.generic.unknownOutcome"],
  // A-326: a failed read changed nothing.
  ["timeout on a read", { kind: "timeout" }, "read", "error.generic.read"],
  [
    "INTERNAL not_applied on a read",
    defined("INTERNAL", 500, { outcome: "not_applied" }),
    "read",
    "error.generic.read",
  ],
  [
    "INTERNAL unknown on a read",
    defined("INTERNAL", 500, { outcome: "unknown" }),
    "read",
    "error.generic.read",
  ],
  [
    "VALIDATION_FAILED",
    defined("VALIDATION_FAILED", 400, { issues: [] }),
    "create",
    "error.validation.form",
  ],
  [
    "RATE_LIMITED 125 s",
    defined("RATE_LIMITED", 429, { retryAfterSeconds: 125 }),
    "create",
    "error.rateLimited",
    { minutes: 3 },
  ],
  [
    "RATE_LIMITED 60 s",
    defined("RATE_LIMITED", 429, { retryAfterSeconds: 60 }),
    "read",
    "error.rateLimited",
    { minutes: 1 },
  ],
  [
    "SERVICE_UNAVAILABLE unknown on a create",
    defined("SERVICE_UNAVAILABLE", 503, { outcome: "unknown" }),
    "create",
    "error.generic.unknownOutcome",
  ],
  [
    "SERVICE_UNAVAILABLE unknown on a read",
    defined("SERVICE_UNAVAILABLE", 503, { outcome: "unknown" }),
    "read",
    "error.unavailable",
  ],
  [
    "SERVICE_UNAVAILABLE not_applied on a create",
    defined("SERVICE_UNAVAILABLE", 503, { outcome: "not_applied" }),
    "create",
    "error.unavailable",
  ],
  ["unavailable on a create", { kind: "unavailable" }, "create", "error.unavailable"],
  ["unavailable on a read", { kind: "unavailable" }, "read", "error.unavailable"],
  ["network on a mutation", { kind: "network" }, "mutation", "error.unavailable"],
  ["network on a read", { kind: "network" }, "read", "error.unavailable"],
  ["NOT_FOUND", defined("NOT_FOUND", 404), "read", "error.notFound"],
  ["FORBIDDEN", defined("FORBIDDEN", 403), "mutation", "error.forbidden"],
  [
    "CLIENT_UPDATE_REQUIRED",
    defined("CLIENT_UPDATE_REQUIRED", 400, { minimumVersion: 8 }),
    "read",
    "update.required.web",
  ],
  ["an unknown key on a read", defined("TEAPOT", 418), "read", "error.generic.read"],
  ["an unknown key on a create", defined("TEAPOT", 418), "create", "error.generic.unknownOutcome"],
  ["unknown on a read", { kind: "unknown" }, "read", "error.generic.read"],
  ["unknown on a mutation", { kind: "unknown" }, "mutation", "error.generic.unknownOutcome"],
];

describe("TP-11.3: messageForError (F-203)", () => {
  for (const [label, error, operation, id, values] of ROWS) {
    it(`TP-11.3: ${label} → ${id}`, async () => {
      const { messageForError } = await loadErrorMessages();

      const message = messageForError(error, operation);

      expect(message.descriptor.id).toBe(id);
      if (values !== undefined) expect(message.values).toEqual(values);
    });
  }

  it("TP-11.3: every message ID the table can return is in en.json", async () => {
    const { messageForError } = await loadErrorMessages();

    const missing = ROWS.map(([, error, operation]) => messageForError(error, operation))
      .map((m) => m.descriptor.id)
      .filter((id) => id === undefined || !(id in EN));

    expect(missing).toEqual([]);
  });
});
