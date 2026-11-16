// F-46 identity:bootstrap-owner through runCli, in process (identity LLD §4.3, S-2). TP-2.5, plus
// extra cases TP-2.5x.
// - The API configuration is the helpers' devApi() with its files written to a temporary
//   directory and DB_* pointing at this file's test database as budmon_app.
// - The CLI's logger writes to process.stderr (cliLogger), so that is the log capture; io.stderr
//   carries only the command's own lines.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toInstantWire, Temporal } from "@budmon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../../../src/platform/db/types.js";
import { runCli } from "../../../src/main/cli.js";
import { invitationFactory, userFactory } from "../../factories/identity.js";
import { devApi } from "../../support/configEnv.js";
import { buildIdentityApi, type IdentityApi } from "../../support/identity.js";
import { call } from "../../support/identityHttp.js";
import { TEST_ROLE_PASSWORDS } from "../../support/postgres.js";
import { resetBetweenTests } from "../../support/testDatabase.js";

const USAGE_LINE = "Usage: identity:bootstrap-owner --email <address> [--replace]";
const REPLACE_HINT =
  "If this link may have been seen or copied by someone else, run the command again with --replace.";

let api: IdentityApi;
let h: DbHandle;
let dir: string;
let env: Record<string, string>;

beforeAll(async () => {
  api = await buildIdentityApi();
  h = api.testDb.database.handle;
  dir = mkdtempSync(path.join(tmpdir(), "budmon-bootstrap-cli-"));
  const f = devApi();
  env = {};
  for (const [key, value] of Object.entries(f.env)) {
    if (value === undefined) continue;
    const content = f.files.get(value);
    if (content === undefined) env[key] = value;
    else {
      const file = path.join(dir, key.toLowerCase());
      writeFileSync(file, content);
      env[key] = file;
    }
  }
  const passwordFile = path.join(dir, "db_password");
  writeFileSync(passwordFile, `${TEST_ROLE_PASSWORDS.budmon_app}\n`);
  Object.assign(env, {
    DB_HOST: api.testDb.endpoint.host,
    DB_PORT: String(api.testDb.endpoint.port),
    DB_NAME: api.testDb.name,
    DB_USER: "budmon_app",
    DB_PASSWORD_FILE: passwordFile,
    OBJECT_STORE_FS_ROOT: path.join(dir, "objects"),
  });
}, 60_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await api.close();
});

beforeEach(async () => {
  await resetBetweenTests(api.testDb);
});

interface Run {
  code: number;
  stdout: string[];
  stderr: string[];
  /** Everything the CLI's logger wrote to process.stderr. */
  logs: string;
}

async function cli(
  argv: string[],
  withEnv: Readonly<Record<string, string | undefined>> = env,
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  let code: number;
  try {
    code = await runCli(argv, withEnv, {
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
  } finally {
    spy.mockRestore();
  }
  return { code, stdout, stderr, logs: written.join("") };
}

/** The structured log lines with this event. */
const logged = (r: Run, event: string): Record<string, unknown>[] =>
  r.logs
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l["event"] === event);

const bootstrapRows = async () =>
  (
    await h.executeSql(
      "SELECT id, status, expires_at FROM invitations WHERE origin = 'bootstrap' ORDER BY created_at, id",
    )
  ).rows;

describe("TP-2.5: identity:bootstrap-owner through runCli", () => {
  it("TP-2.5: --email Owner@X.com on a database without an owner → the three exact stdout lines, exit 0; the link's token previews; the log has bootstrap_owner_created and no bmi_", async () => {
    const r = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"]);

    expect(r.code, r.stderr.join("\n")).toBe(0);
    expect(r.stderr).toEqual([]);
    const rows = await bootstrapRows();
    expect(rows).toHaveLength(1);
    const expires = toInstantWire(
      Temporal.Instant.fromEpochMilliseconds((rows[0]?.["expires_at"] as Date).getTime()),
    );
    expect(r.stdout).toHaveLength(3);
    expect(r.stdout[0]).toBe(
      `Owner invitation created. Open this link within 7 days (expires ${expires}):`,
    );
    const link = /^http:\/\/localhost:5173\/invite#t=(bmi_[A-Za-z0-9_-]{43})$/.exec(
      r.stdout[1] ?? "",
    );
    expect(link, r.stdout[1]).not.toBeNull();
    expect(r.stdout[2]).toBe(REPLACE_HINT);
    const preview = await call(api.app, "POST", "/invitations/preview", { token: link?.[1] });
    expect(preview.status).toBe(200);
    expect(preview.json()).toMatchObject({
      email: "owner@x.com",
      origin: "bootstrap",
      inviterName: null,
    });
    expect(logged(r, "bootstrap_owner_created")).toEqual([
      expect.objectContaining({ entityId: rows[0]?.["id"] }),
    ]);
    expect(r.logs).not.toContain("bmi_");
  }, 60_000);

  it("TP-2.5: an owner exists → one stderr line 'An owner already exists.', exit 1, nothing on stdout", async () => {
    await userFactory(h, { isProductOwner: true, inviteAllowance: null });

    const r = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toEqual(["An owner already exists."]);
    expect(r.stdout).toEqual([]);
  }, 60_000);

  it("TP-2.5: a pending bootstrap → one stderr line with its expiry and the --replace hint, exit 1", async () => {
    const first = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"]);
    expect(first.code).toBe(0);
    const [row] = await bootstrapRows();
    const expires = toInstantWire(
      Temporal.Instant.fromEpochMilliseconds((row?.["expires_at"] as Date).getTime()),
    );

    const r = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toEqual([
      `An owner invitation is already waiting (expires ${expires}). Run again with --replace to cancel it and create a new link.`,
    ]);
    expect(r.stdout).toEqual([]);
  }, 60_000);

  it("TP-2.5: a user with the email → one stderr line 'That email already belongs to a user.', exit 1", async () => {
    await userFactory(h, { email: "owner@x.com" });

    const r = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toEqual(["That email already belongs to a user."]);
    expect(r.stdout).toEqual([]);
  }, 60_000);

  it("TP-2.5: --email x → one stderr line 'Enter a valid email address.', exit 1", async () => {
    const r = await cli(["identity:bootstrap-owner", "--email", "x"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toEqual(["Enter a valid email address."]);
    expect(r.stdout).toEqual([]);
  }, 60_000);

  it("TP-2.5: --replace with a pending bootstrap → exit 0, the old invitation revoked and a new link printed", async () => {
    const old = await invitationFactory(h, {
      email: "first-owner@example.com",
      origin: "bootstrap",
      now: Temporal.Now.instant(),
      withToken: true,
    });

    const r = await cli(["identity:bootstrap-owner", "--replace", "--email", "Owner@X.com"]);

    expect(r.code, r.stderr.join("\n")).toBe(0);
    const rows = await bootstrapRows();
    expect(rows.find((x) => x["id"] === old.invitationId)).toMatchObject({ status: "revoked" });
    expect(rows.filter((x) => x["status"] === "pending")).toHaveLength(1);
    expect(r.stdout[1]).toMatch(/^http:\/\/localhost:5173\/invite#t=bmi_[A-Za-z0-9_-]{43}$/);
    expect(r.logs).not.toContain("bmi_");
  }, 60_000);

  it.each([
    ["no --email", ["identity:bootstrap-owner"]],
    ["an unknown flag", ["identity:bootstrap-owner", "--email", "Owner@X.com", "--force"]],
    [
      "a repeated --email",
      ["identity:bootstrap-owner", "--email", "a@x.com", "--email", "b@x.com"],
    ],
  ])(
    "TP-2.5: %s with an empty env → the usage line on stderr and exit 64, before any configuration is read",
    async (_label, argv) => {
      const r = await cli(argv, {});

      expect(r.code).toBe(64);
      expect(r.stderr).toContain(USAGE_LINE);
      expect(r.stderr.join("\n")).not.toContain("Configuration invalid:");
      expect(r.stdout).toEqual([]);
    },
  );

  it.each([
    ["--email without a value", ["identity:bootstrap-owner", "--email"]],
    [
      "a repeated --replace",
      ["identity:bootstrap-owner", "--email", "a@x.com", "--replace", "--replace"],
    ],
  ])("TP-2.5x: %s with an empty env → the usage line and exit 64", async (_label, argv) => {
    const r = await cli(argv, {});

    expect(r.code).toBe(64);
    expect(r.stderr).toContain(USAGE_LINE);
    expect(r.stderr.join("\n")).not.toContain("Configuration invalid:");
  });

  it("TP-2.5: a valid call with a configuration problem (no PUBLIC_ORIGIN) → 'Configuration invalid:' on stderr and exit 78; nothing created", async () => {
    const broken = { ...env };
    delete broken["PUBLIC_ORIGIN"];

    const r = await cli(["identity:bootstrap-owner", "--email", "Owner@X.com"], broken);

    expect(r.code).toBe(78);
    expect(r.stderr.some((l) => l.startsWith("Configuration invalid:"))).toBe(true);
    expect(r.stdout).toEqual([]);
    expect(await bootstrapRows()).toEqual([]);
  }, 60_000);

  it("TP-2.5: USAGE (printed for an unknown command) lists identity:bootstrap-owner", async () => {
    const r = await cli(["no-such-command"], {});

    expect(r.code).toBe(64);
    expect(r.stderr.join("\n").split("\n")).toContain(
      "  identity:bootstrap-owner --email <address> [--replace]",
    );
  });
});
