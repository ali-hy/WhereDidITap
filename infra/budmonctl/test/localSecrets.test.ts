// F-191 initLocalSecrets. TP-15.23.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLocalSecrets } from "../src/localSecrets.js";

const ROLES = ["budmon_app", "budmon_capture", "budmon_queue", "budmon_monitor", "budmon_migrator"];

/** The F-191 table: generated files and placeholders per directory. */
const GENERATED: Record<string, string[]> = {
  "main/api": [
    "DB_PASSWORD",
    "CURSOR_KEY",
    "RATE_LIMIT_HMAC_KEY",
    "API_SECRETS_KEYS",
    "RECOVERY_CODE_HMAC_KEYS",
  ],
  "main/worker-general": ["DB_PASSWORD", "QUEUE_DB_PASSWORD", "SMTP_PASSWORD"],
  "main/migrate": ["DB_PASSWORD", "ROLE_SECRETS"],
  "main/postgres": ["ADMIN_PASSWORD", "MIGRATOR_VERIFIER"],
  "capture/worker-capture": ["DB_PASSWORD", "MAILBOX_HMAC_KEY"],
};
const PLACEHOLDERS: Record<string, string[]> = {
  "main/api": [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "CAPTURE_PUBLIC_KEY",
    "GOOGLE_SIGNIN_CLIENT_SECRET",
  ],
  "main/worker-general": [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "FX_PRIMARY_APP_ID",
    "CAPTURE_PUBLIC_KEY",
  ],
  "main/migrate": [],
  "main/postgres": [],
  "capture/worker-capture": ["GCP_CREDENTIALS", "GOOGLE_OAUTH_CLIENT_SECRET", "CAPTURE_PUBLIC_KEY"],
};

function fakeFs(existing: string[] = []) {
  const files = new Map<string, { data: string; mode: number; order: number }>();
  const dirs = new Map<string, number>();
  const present = new Set(existing);
  let n = 0;
  let counter = 0;
  return {
    files,
    dirs,
    deps: {
      // Sequential bytes, so every value differs and is predictable.
      randomBytes: (len: number) => Buffer.from(Array.from({ length: len }, () => counter++ % 256)),
      mkdir: (p: string, mode: number) => {
        dirs.set(p, mode);
        return Promise.resolve();
      },
      writeFile: (p: string, data: string, mode: number) => {
        files.set(p, { data, mode, order: n++ });
        return Promise.resolve();
      },
      exists: (p: string) => Promise.resolve(present.has(p) || files.has(p) || dirs.has(p)),
    },
  };
}

describe("TP-15.23: initLocalSecrets (F-191)", () => {
  it("TP-15.23: writes exactly F-191's files under /h/secrets/<role>/<service>/, files 0600, directories 0700, the marker last", async () => {
    const fs = fakeFs();

    const result = await initLocalSecrets({ budmonHome: "/h" }, fs.deps);

    const expected = Object.entries(GENERATED).flatMap(([dir, names]) =>
      [...names, ...(PLACEHOLDERS[dir] ?? [])].map((f) => `/h/secrets/${dir}/${f}`),
    );
    const written = [...fs.files.keys()].filter((p) => p !== "/h/secrets/.initialised");
    expect(written.sort()).toEqual(expected.sort());
    for (const { mode } of fs.files.values()) expect(mode).toBe(0o600);
    for (const mode of fs.dirs.values()) expect(mode).toBe(0o700);
    for (const dir of Object.keys(GENERATED)) expect(fs.dirs.has(`/h/secrets/${dir}`)).toBe(true);
    const marker = fs.files.get("/h/secrets/.initialised");
    expect(marker?.order).toBe(fs.files.size - 1);
    // F-191 doesn't say whether `files` is absolute or relative to secrets/, or whether it lists
    // the .initialised marker (asked); either way it names the table's files.
    expect(
      result.files
        .map((f) => path.resolve("/h/secrets", f))
        .filter((f) => f !== "/h/secrets/.initialised")
        .sort(),
    ).toEqual([...expected].sort());
  });

  it("TP-15.23: api's and worker-general's DB_PASSWORD are the same (both budmon_app); passwords differ otherwise", async () => {
    const fs = fakeFs();
    await initLocalSecrets({ budmonHome: "/h" }, fs.deps);
    const v = (p: string) => fs.files.get(`/h/secrets/${p}`)?.data ?? "";

    expect(v("main/api/DB_PASSWORD")).toBe(v("main/worker-general/DB_PASSWORD"));
    expect(v("main/api/DB_PASSWORD")).not.toBe(v("main/migrate/DB_PASSWORD"));
    expect(v("main/api/DB_PASSWORD")).not.toBe(v("capture/worker-capture/DB_PASSWORD"));
    expect(v("main/api/DB_PASSWORD")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("TP-15.23: RECOVERY_CODE_HMAC_KEYS (and API_SECRETS_KEYS) parse as a one-key ring", async () => {
    const fs = fakeFs();
    await initLocalSecrets({ budmonHome: "/h" }, fs.deps);
    for (const name of ["RECOVERY_CODE_HMAC_KEYS", "API_SECRETS_KEYS"]) {
      const ring = JSON.parse(fs.files.get(`/h/secrets/main/api/${name}`)?.data ?? "") as {
        current: string;
        keys: Record<string, string>;
      };
      expect(Object.keys(ring.keys)).toEqual([ring.current]);
      expect(Buffer.from(ring.keys[ring.current] ?? "", "base64")).toHaveLength(32);
    }
  });

  it("TP-15.23: placeholders are exactly __FILL_ME__, GOOGLE_SIGNIN_CLIENT_SECRET among them; SMTP_PASSWORD exists and is empty (A-2, A-3)", async () => {
    const fs = fakeFs();
    await initLocalSecrets({ budmonHome: "/h" }, fs.deps);

    for (const [dir, names] of Object.entries(PLACEHOLDERS)) {
      for (const n of names)
        expect(fs.files.get(`/h/secrets/${dir}/${n}`)?.data, `${dir}/${n}`).toBe("__FILL_ME__");
    }
    expect(fs.files.get("/h/secrets/main/worker-general/SMTP_PASSWORD")?.data).toBe("");
    for (const [path, f] of fs.files) {
      if (f.data.includes("__FILL_ME__")) expect(f.data, path).toBe("__FILL_ME__");
    }
  });

  it("TP-15.23: ROLE_SECRETS is JSON with a SCRAM-SHA-256$4096: verifier for each of the five login roles and no plaintext password", async () => {
    const fs = fakeFs();
    await initLocalSecrets({ budmonHome: "/h" }, fs.deps);
    const raw = fs.files.get("/h/secrets/main/migrate/ROLE_SECRETS")?.data ?? "";
    const secrets = JSON.parse(raw) as Record<string, { verifier?: string; password?: string }>;

    expect(Object.keys(secrets).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      expect(secrets[role]?.verifier).toMatch(/^SCRAM-SHA-256\$4096:/);
      expect(secrets[role]?.password).toBeUndefined();
    }
    for (const [path, f] of fs.files) {
      if (path.endsWith("DB_PASSWORD") || path.endsWith("QUEUE_DB_PASSWORD")) {
        expect(raw).not.toContain(f.data);
      }
    }
    expect(fs.files.get("/h/secrets/main/postgres/MIGRATOR_VERIFIER")?.data).toMatch(
      /^SCRAM-SHA-256\$4096:/,
    );
  });

  it("TP-15.23: no capture key under main/ and no main key under capture/", async () => {
    const fs = fakeFs();
    await initLocalSecrets({ budmonHome: "/h" }, fs.deps);
    const names = (prefix: string) =>
      [...fs.files.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.split("/").pop());

    expect(names("/h/secrets/main/")).not.toContain("GCP_CREDENTIALS");
    expect(names("/h/secrets/main/")).not.toContain("MAILBOX_HMAC_KEY");
    expect(names("/h/secrets/main/")).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET");
    for (const k of [
      "CURSOR_KEY",
      "RATE_LIMIT_HMAC_KEY",
      "API_SECRETS_KEYS",
      "QUEUE_DB_PASSWORD",
      "ROLE_SECRETS",
      "ADMIN_PASSWORD",
    ]) {
      expect(names("/h/secrets/capture/")).not.toContain(k);
    }
  });

  it("TP-15.23: a second call with /h/secrets existing rejects (exit 2 in the CLI) and writes nothing", async () => {
    const fs = fakeFs(["/h/secrets"]);

    await expect(initLocalSecrets({ budmonHome: "/h" }, fs.deps)).rejects.toThrow();
    expect(fs.files.size).toBe(0);
    expect(fs.dirs.size).toBe(0);
  });
});
