// The laptop stack's static checks (S-15, F-170, F-175): TP-15.30, TP-15.31, TP-15.16's static
// parts (docker compose config of both laptop files, no published Postgres port, loopback-only
// Caddy), plus extra cases TP-15.33x for F-175's per-service settings, pg_hba.conf, pg_ident.conf,
// postgresql.conf, local.env and the Caddyfile. IDs ending in "x" are test-architect additions, not
// LLD test-plan IDs. `docker compose config` needs only the Docker CLI (no daemon work).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { outputAlternatives } from "./support/changesJob.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL = path.join(ROOT, "infra/local");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** A site.env with throwaway values in valid shapes (F-175's table). */
const SITE_ENV = `PUBLIC_ORIGIN=https://laptop.tailnet.ts.net
CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1
GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com
S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
S3_REGION=eu-central-003
S3_BUCKET_EXPORTS=budmon-exports
S3_BUCKET_ERASURE_LOG=budmon-erasure-log
SENTRY_DSN=https://k@o1.ingest.sentry.io/1
GOOGLE_SIGNIN_CLIENT_ID=123-signin.apps.googleusercontent.com
GOOGLE_SIGNIN_ANDROID_CLIENT_IDS=
GOOGLE_SIGNIN_CALLBACK_ORIGIN=http://localhost:8080
GOOGLE_SIGNIN_APP_ORIGINS=https://laptop.tailnet.ts.net,http://localhost:8080
SMTP_URL=smtp://mailpit:1025
EMAIL_FROM=Budmon <no-reply@budmon.local>
`;

interface Service {
  image?: string;
  user?: string;
  read_only?: boolean;
  tmpfs?: unknown;
  cap_drop?: string[];
  security_opt?: string[];
  restart?: string;
  stop_grace_period?: string;
  command?: string[] | string;
  networks?: Record<string, { ipv4_address?: string } | null>;
  ports?: { host_ip?: string; published?: string | number; target?: number; protocol?: string }[];
  mem_limit?: string | number;
  deploy?: { resources?: { limits?: { memory?: string | number } } };
  environment?: Record<string, string | null>;
  volumes?: {
    type?: string;
    source?: string;
    target?: string;
    read_only?: boolean;
    bind?: { create_host_path?: boolean };
  }[];
  profiles?: string[];
  logging?: { driver?: string };
  extra_hosts?: string[] | Record<string, string>;
  healthcheck?: { test?: string[]; interval?: string; retries?: number };
}
interface ComposeConfig {
  services?: Record<string, Service>;
  networks?: Record<
    string,
    { internal?: boolean; external?: boolean; name?: string; ipam?: unknown }
  >;
}

let home: string;

function composeConfig(files: readonly string[], env: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    BUDMON_HOME: home,
    BUDMON_TAG: "v1.0.0",
    ...env,
  };
  for (const [k, v] of Object.entries(merged))
    if (v === undefined) Reflect.deleteProperty(merged, k);
  const args = ["compose", "--project-directory", LOCAL];
  for (const f of files) args.push("-f", path.join(LOCAL, f));
  // `migrate` is in profile tools; config omits profile-gated services otherwise.
  args.push("--env-file", path.join(LOCAL, "local.env"), "--profile", "tools");
  args.push("config", "--format", "json");
  const result = spawnSync("docker", args, { encoding: "utf8", env: merged });
  return {
    status: result.status,
    stderr: result.stderr,
    config: result.status === 0 ? (JSON.parse(result.stdout) as ComposeConfig) : null,
  };
}

let main: ComposeConfig;
let capture: ComposeConfig;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "budmon-home-"));
  writeFileSync(path.join(home, "site.env"), SITE_ENV, { mode: 0o600 });
  const m = composeConfig(["compose.main.yaml"]);
  const c = composeConfig(["compose.capture.yaml"]);
  main = m.config ?? {};
  capture = c.config ?? {};
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

const svc = (cfg: ComposeConfig, name: string): Service => {
  const s = cfg.services?.[name];
  if (s === undefined) throw new Error(`no service ${name}`);
  return s;
};
const memory = (s: Service) => String(s.deploy?.resources?.limits?.memory ?? s.mem_limit ?? "");
const commandOf = (s: Service) =>
  Array.isArray(s.command) ? s.command.join(" ") : (s.command ?? "");

describe("TP-15.30: the Postgres image's base equals POSTGRES_IMAGE (A-61)", () => {
  it("TP-15.30: images/postgres/Dockerfile's first FROM is POSTGRES_IMAGE exactly, digest included", () => {
    const pinned = /POSTGRES_IMAGE\s*=\s*"([^"]+)"/.exec(
      read("apps/server/test/setup/postgresImage.ts"),
    )?.[1];
    const from = /^FROM\s+(\S+)/m.exec(read("images/postgres/Dockerfile"))?.[1];

    expect(pinned).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(from).toBe(pinned);
  });
});

describe("TP-15.31: laptop images are digest-pinned; Mailpit matches the development stack (A-70)", () => {
  it("TP-15.31: every image: in compose.main.yaml and compose.capture.yaml that isn't built locally is pinned by @sha256", () => {
    for (const file of ["infra/local/compose.main.yaml", "infra/local/compose.capture.yaml"]) {
      const doc = parse(read(file)) as { services?: Record<string, { image?: string }> };
      for (const [name, s] of Object.entries(doc.services ?? {})) {
        const image = s.image ?? "";
        // F-175: budmon/<image>:<tag> are built locally by F-178 from the release.
        if (image.startsWith("budmon/")) continue;
        expect(image, `${file} ${name}`).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
    }
  });

  it("TP-15.31: the mailpit references in infra/compose.yaml and compose.main.yaml are identical", () => {
    const dev = parse(read("infra/compose.yaml")) as {
      services?: Record<string, { image?: string }>;
    };
    const laptop = parse(read("infra/local/compose.main.yaml")) as {
      services?: Record<string, { image?: string }>;
    };

    expect(laptop.services?.["mailpit"]?.image).toBeDefined();
    expect(laptop.services?.["mailpit"]?.image).toBe(dev.services?.["mailpit"]?.image);
  });
});

describe("TP-15.16: compose config and published ports", () => {
  it("TP-15.16: docker compose config of both laptop files with local.env succeeds", () => {
    const both = composeConfig(["compose.main.yaml", "compose.capture.yaml"]);

    expect(both.status, both.stderr).toBe(0);
  });

  it("TP-15.16: postgres publishes no port", () => {
    expect(svc(main, "postgres").ports ?? []).toEqual([]);
  });

  it("TP-15.16: caddy publishes only 127.0.0.1:8080:8080", () => {
    const ports = (svc(main, "caddy").ports ?? []).map(
      (p) => `${p.host_ip ?? ""}:${String(p.published)}:${String(p.target)}`,
    );

    expect(ports).toEqual(["127.0.0.1:8080:8080"]);
  });

  it("TP-15.33x (A-2): mailpit publishes only 127.0.0.1:8025:8025, and no other service publishes anything", () => {
    const published = Object.entries({ ...main.services, ...capture.services }).flatMap(
      ([name, s]) =>
        (s.ports ?? []).map(
          (p) => `${name} ${p.host_ip ?? ""}:${String(p.published)}:${String(p.target)}`,
        ),
    );

    expect(published.sort()).toEqual(["caddy 127.0.0.1:8080:8080", "mailpit 127.0.0.1:8025:8025"]);
  });

  it("TP-15.27: an unset BUDMON_TAG makes compose config fail", () => {
    expect(composeConfig(["compose.main.yaml"], { BUDMON_TAG: undefined }).status).not.toBe(0);
  });
});

const APP = {
  api: {
    uid: "10001",
    grace: "15s",
    mem: 512,
    cmd: "node --import ./dist/main/instrument.js dist/main/api.js",
  },
  "worker-general": {
    uid: "10002",
    grace: "45s",
    mem: 384,
    cmd: "node --import ./dist/main/instrument.js dist/main/worker.js",
  },
  migrate: { uid: "10004", grace: undefined, mem: 256, cmd: "node dist/main/migrate.js" },
} as const;

/** Compose resolves memory to bytes (or keeps the string); compare in MiB. */
const mib = (v: string) => {
  const m = /^(\d+)\s*([kmg]?)b?$/i.exec(v.trim());
  if (m === null) return Number.NaN;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "g" ? n * 1024 : unit === "m" ? n : unit === "k" ? n / 1024 : n / 1048576;
};

describe("TP-15.33x: F-175 per-service settings (main project)", () => {
  it.each(Object.entries(APP))(
    "TP-15.33x: %s is read-only with /tmp tmpfs, no capabilities, no-new-privileges, its own UID, its command and memory",
    (name, want) => {
      const s = svc(main, name);

      expect(s.read_only).toBe(true);
      expect(JSON.stringify(s.tmpfs)).toContain("/tmp");
      expect(s.cap_drop).toEqual(["ALL"]);
      expect(s.security_opt).toContain("no-new-privileges:true");
      expect(String(s.user).split(":")[0]).toBe(want.uid);
      expect(commandOf(s)).toBe(want.cmd);
      expect(mib(memory(s))).toBe(want.mem);
      if (want.grace !== undefined) expect(s.stop_grace_period).toBe(want.grace);
    },
  );

  it("TP-15.33x: api and worker-general restart unless-stopped; migrate is in profile tools", () => {
    expect(svc(main, "api").restart).toBe("unless-stopped");
    expect(svc(main, "worker-general").restart).toBe("unless-stopped");
    expect(svc(main, "migrate").profiles).toEqual(["tools"]);
  });

  it("TP-15.33x: api env: DB_HOST postgres, DB_USER budmon_app, HOST 0.0.0.0, PORT 3000, BUDMON_RELEASE = the tag, TRUSTED_PROXY from local.env", () => {
    expect(svc(main, "api").environment).toMatchObject({
      DB_HOST: "postgres",
      DB_USER: "budmon_app",
      HOST: "0.0.0.0",
      PORT: "3000",
      BUDMON_RELEASE: "v1.0.0",
      TRUSTED_PROXY: "172.30.41.2",
    });
  });

  it("TP-15.33x: worker-general env: DB_USER budmon_app, QUEUE_DB_USER budmon_queue, WORKER_ROLES general; migrate: DB_USER budmon_migrator", () => {
    expect(svc(main, "worker-general").environment).toMatchObject({
      DB_HOST: "postgres",
      DB_USER: "budmon_app",
      QUEUE_DB_USER: "budmon_queue",
      WORKER_ROLES: "general",
    });
    expect(svc(main, "migrate").environment).toMatchObject({
      DB_HOST: "postgres",
      DB_USER: "budmon_migrator",
    });
  });

  it("TP-15.33x: each application service's secrets are its own directory, read-only, at /run/secrets", () => {
    const dirs: Record<string, string> = {
      api: "secrets/main/api",
      "worker-general": "secrets/main/worker-general",
      migrate: "secrets/main/migrate",
      postgres: "secrets/main/postgres",
    };
    for (const [name, dir] of Object.entries(dirs)) {
      const mount = (svc(main, name).volumes ?? []).find((v) => v.target === "/run/secrets");
      expect(mount?.source, name).toBe(path.join(home, dir));
      expect(mount?.read_only, name).toBe(true);
    }
  });

  it("TP-15.33x: caddy runs as 10005 on edge at CADDY_EDGE_IP with 128m, mounting maintenance read-only", () => {
    const c = svc(main, "caddy");

    expect(String(c.user).split(":")[0]).toBe("10005");
    expect(c.networks?.["edge"]?.ipv4_address).toBe("172.30.41.2");
    expect(mib(memory(c))).toBe(128);
    const m = (c.volumes ?? []).find((v) => v.target === "/srv/maintenance");
    expect(m?.source).toBe(path.join(home, "maintenance"));
    expect(m?.read_only).toBe(true);
  });

  it("TP-15.33x: postgres: data and capture-db addresses, 1g, the pg bind mount without host-path creation, BUDMON_LISTEN_ADDRESSES", () => {
    const p = svc(main, "postgres");

    expect(p.networks?.["data"]?.ipv4_address).toBe("172.30.40.10");
    expect(p.networks?.["capture-db"]?.ipv4_address).toBe("172.30.42.2");
    expect(mib(memory(p))).toBe(1024);
    const data = (p.volumes ?? []).find((v) => v.target === "/var/lib/postgresql/data");
    expect(data?.source).toBe(path.join(home, "pg"));
    // Read from the file itself: some Compose versions drop create_host_path from `config`.
    const raw = parse(read("infra/local/compose.main.yaml")) as {
      services?: Record<string, { volumes?: Service["volumes"] }>;
    };
    const rawData = (raw.services?.["postgres"]?.volumes ?? []).find(
      (v) => typeof v === "object" && v.target === "/var/lib/postgresql/data",
    );
    expect(rawData?.bind?.create_host_path).toBe(false);
    expect(p.environment?.["BUDMON_LISTEN_ADDRESSES"]).toBe("172.30.40.10,172.30.42.2");
  });

  it("TP-15.33x (A-2): mailpit: --quiet, logging none, user 10006, data and mail-ui networks, 128m, no secrets", () => {
    const m = svc(main, "mailpit");

    expect(commandOf(m)).toBe("--quiet");
    expect(m.logging?.driver).toBe("none");
    expect(String(m.user).split(":")[0]).toBe("10006");
    expect(Object.keys(m.networks ?? {}).sort()).toEqual(["data", "mail-ui"]);
    expect(mib(memory(m))).toBe(128);
    expect((m.volumes ?? []).filter((v) => v.target === "/run/secrets")).toEqual([]);
  });

  it("TP-15.33x: networks: edge and egress bridges, data internal, mail-ui, capture-db external budmon_capture_db", () => {
    const n = main.networks ?? {};

    expect(n["data"]?.internal).toBe(true);
    expect(n["edge"]?.internal ?? false).toBe(false);
    expect(n["egress"]?.internal ?? false).toBe(false);
    expect(n["mail-ui"]).toBeDefined();
    expect(n["capture-db"]?.external).toBe(true);
    expect(n["capture-db"]?.name).toBe("budmon_capture_db");
  });

  it("TP-15.33x: service networks: api edge+data+egress, worker-general data+egress, migrate data", () => {
    expect(Object.keys(svc(main, "api").networks ?? {}).sort()).toEqual(["data", "edge", "egress"]);
    expect(Object.keys(svc(main, "worker-general").networks ?? {}).sort()).toEqual([
      "data",
      "egress",
    ]);
    expect(Object.keys(svc(main, "migrate").networks ?? {}).sort()).toEqual(["data"]);
  });
});

describe("TP-15.33x: the capture project (F-175)", () => {
  it("TP-15.33x: worker-capture: UID 10003, 45s grace, 384m, its command, WORKER_ROLES capture, verify-full to db.budmon.internal", () => {
    const w = svc(capture, "worker-capture");

    expect(String(w.user).split(":")[0]).toBe("10003");
    expect(w.stop_grace_period).toBe("45s");
    expect(mib(memory(w))).toBe(384);
    expect(commandOf(w)).toBe("node --import ./dist/main/instrument.js dist/main/worker.js");
    expect(w.read_only).toBe(true);
    expect(w.cap_drop).toEqual(["ALL"]);
    expect(w.environment).toMatchObject({
      DB_HOST: "db.budmon.internal",
      DB_USER: "budmon_capture",
      WORKER_ROLES: "capture",
      DB_SSLMODE: "verify-full",
      DB_SSL_ROOT_CERT_FILE: "/run/secrets/DB_CA_CERT",
      BUDMON_RELEASE: "v1.0.0",
    });
    expect(JSON.stringify(w.extra_hosts)).toContain("db.budmon.internal");
    expect(JSON.stringify(w.extra_hosts)).toContain("172.30.42.2");
    expect(w.networks?.["capture-db"]?.ipv4_address).toBe("172.30.42.4");
  });

  it("TP-15.33x: worker-capture has no proxy variables and no OTLP endpoint", () => {
    const keys = Object.keys(svc(capture, "worker-capture").environment ?? {});

    // Egress proxy variables (TRUSTED_PROXY, from local.env, is Fastify's and not one of them).
    expect(
      keys.filter((k) => /^(https?_proxy|no_proxy|all_proxy)$|OTEL_EXPORTER_OTLP/i.test(k)),
    ).toEqual([]);
  });
});

describe("TP-15.33x: Postgres configuration files (F-170, F-175)", () => {
  it("TP-15.33x: pg_hba.conf is exactly F-175's rules", () => {
    const rules = read("infra/local/postgres/pg_hba.conf")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
      .map((l) => l.split(/\s+/).join(" "));

    expect(rules).toEqual([
      "local all budmon_admin peer map=local_admin",
      "local all all reject",
      "hostssl budmon budmon_capture 172.30.42.4/32 scram-sha-256",
      "host budmon budmon_app,budmon_queue,budmon_migrator 172.30.40.0/24 scram-sha-256",
      "host budmon_restore budmon_migrator 172.30.40.0/24 scram-sha-256",
      "host all all 0.0.0.0/0 reject",
      "hostssl all all 0.0.0.0/0 reject",
    ]);
  });

  it("TP-15.33x: pg_ident.conf maps postgres to budmon_admin", () => {
    const lines = read("infra/local/postgres/pg_ident.conf")
      .split("\n")
      .map((l) => l.trim().split(/\s+/).join(" "))
      .filter((l) => l !== "" && !l.startsWith("#"));

    expect(lines).toEqual(["local_admin postgres budmon_admin"]);
  });

  it("TP-15.33x: postgresql.conf has F-170's logging, TLS, WAL and extension settings", () => {
    const conf = read("infra/local/postgres/postgresql.conf");
    const settings = Object.fromEntries(
      conf
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter((l) => l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [
            l.slice(0, i).trim(),
            l
              .slice(i + 1)
              .trim()
              .replace(/^'(.*)'$/, "$1"),
          ];
        }),
    );

    expect(settings).toMatchObject({
      log_error_verbosity: "terse",
      log_min_error_statement: "panic",
      log_statement: "none",
      log_parameter_max_length: "0",
      log_parameter_max_length_on_error: "0",
      log_destination: "stderr",
      password_encryption: "scram-sha-256",
      ssl: "on",
      ssl_cert_file: "/run/secrets/TLS_CERT",
      ssl_key_file: "/run/secrets/TLS_KEY",
      max_connections: "100",
      wal_level: "replica",
      archive_mode: "off",
      shared_preload_libraries: "pg_stat_statements",
      "pg_stat_statements.track_utility": "off",
      shared_buffers: "512MB",
    });
  });
});

describe("TP-15.33x: local.env (F-175)", () => {
  it("TP-15.33x: local.env holds F-175's non-secret values", () => {
    const env = Object.fromEntries(
      read("infra/local/local.env")
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );

    expect(env).toMatchObject({
      EDGE_SUBNET: "172.30.41.0/24",
      CADDY_EDGE_IP: "172.30.41.2",
      TRUSTED_PROXY: "172.30.41.2",
      DATA_SUBNET: "172.30.40.0/24",
      PG_DATA_IP: "172.30.40.10",
      CAPTURE_DB_SUBNET: "172.30.42.0/29",
      PG_CAPTURE_IP: "172.30.42.2",
      WORKER_CAPTURE_IP: "172.30.42.4",
      APP_ENV: "production",
      KMS_PROVIDER: "gcp",
      FX_PROVIDER: "live",
      OBJECT_STORE_KIND: "s3",
      DB_NAME: "budmon",
      DB_PORT: "5432",
      GOOGLE_OAUTH_REDIRECT_ORIGIN: "http://localhost:8080",
    });
  });

  it("TP-15.33x: no secret-looking key is committed in local.env", () => {
    expect(read("infra/local/local.env")).not.toMatch(/PASSWORD|SECRET|_KEY=|TOKEN/);
  });
});

describe("TP-15.33x: the Caddyfile (F-175)", () => {
  it("TP-15.33x: auto_https off, site :8080, the API proxy and the exact CSP", () => {
    const caddy = read("infra/local/Caddyfile");

    expect(caddy).toMatch(/auto_https\s+off/);
    expect(caddy).toMatch(/^:8080\s*\{/m);
    expect(caddy).toMatch(/reverse_proxy\s+api:3000/);
    expect(caddy).toContain(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.de.sentry.io https://*.ingest.sentry.io; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    expect(caddy).toContain(
      '{"defined":true,"code":"SERVICE_UNAVAILABLE","status":503,"message":"Service unavailable","data":{"outcome":"not_applied"}}',
    );
    expect(caddy).toMatch(/request>uri\s+regexp\s+"?\\\?\.\*\$"?\s+""/);
    expect(caddy).toMatch(/request>headers\s+delete/);
  });
});

describe("TP-15.16: the files exist", () => {
  it.each([
    ["infra/local/budmon-local"],
    ["infra/local/gcp-bootstrap.sh"],
    ["infra/local/compose.main.yaml"],
    ["infra/local/compose.capture.yaml"],
    ["infra/local/local.env"],
    ["infra/local/Caddyfile"],
    ["images/server/Dockerfile"],
    ["images/web/Dockerfile"],
    ["images/postgres/Dockerfile"],
    ["images/postgres/budmon-entrypoint.sh"],
    ["infra/runbooks/stage0-laptop.md"],
  ])("TP-15.16: %s exists", (rel) => {
    expect(existsSync(path.join(ROOT, rel))).toBe(true);
  });
});

describe("TP-15.16: shellcheck and the infra-lint job", () => {
  it("TP-15.16: shellcheck passes on budmon-local, gcp-bootstrap.sh, infra/local/lib/*.sh and images/postgres/*.sh", () => {
    const files = [
      "infra/local/budmon-local",
      "infra/local/gcp-bootstrap.sh",
      "infra/local/lib/common.sh",
      "infra/local/lib/secrets.sh",
      "infra/local/lib/release.sh",
      "infra/local/lib/stack.sh",
      "images/postgres/budmon-entrypoint.sh",
      "infra/local/test/setup-bats.sh",
      "infra/local/test/run-integration.sh",
    ].map((f) => path.join(ROOT, f));
    const result = spawnSync("shellcheck", ["-x", ...files], { encoding: "utf8" });

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it("TP-15.16: ci.yml's infra-lint job runs shellcheck, pnpm test:bats, compose config and actionlint", () => {
    const wf = parse(read(".github/workflows/ci.yml")) as {
      jobs?: Record<string, { steps?: { run?: unknown }[] }>;
    };
    const runs = (wf.jobs?.["infra-lint"]?.steps ?? [])
      .map((s) => (typeof s.run === "string" ? s.run : ""))
      .join("\n");

    expect(wf.jobs?.["infra-lint"]).toBeDefined();
    expect(runs).toMatch(/shellcheck/);
    expect(runs).toMatch(/pnpm test:bats/);
    expect(runs).toMatch(/docker compose .*compose\.main\.yaml.*compose\.capture\.yaml.*config/);
    expect(runs).toMatch(/actionlint/);
  });
});

/** The text after the Dockerfile's last FROM matching `from`. */
function lastStage(rel: string, from: RegExp): string {
  const text = read(rel);
  const starts = [...text.matchAll(/^FROM .*$/gm)].filter((m) => from.test(m[0]));
  const last = starts.at(-1);
  return last === undefined ? "" : text.slice(last.index);
}

/** The Caddyfile's top-level blocks: the global options block (no address) and site blocks. */
function caddyBlocks(): { global: string; sites: string[] } {
  const lines = read("infra/local/Caddyfile").split("\n");
  let depth = 0;
  let current: { head: string; body: string[] } | null = null;
  const blocks: { head: string; body: string[] }[] = [];
  for (const line of lines) {
    const code = line.replace(/#.*$/, "");
    if (depth === 0 && /\{\s*$/.test(code)) {
      current = { head: code.replace(/\{\s*$/, "").trim(), body: [] };
      blocks.push(current);
    } else if (current !== null && depth > 0) {
      current.body.push(line);
    }
    depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
  }
  return {
    global: blocks
      .filter((b) => b.head === "")
      .flatMap((b) => b.body)
      .join("\n"),
    sites: blocks.filter((b) => b.head !== "").map((b) => b.head),
  };
}

// A-419: the web image and the Caddyfile.
describe("TP-15.33: the web image and the Caddyfile (A-417, A-419)", () => {
  it("TP-15.33: the last stage, from a digest-pinned caddy, removes the file capability, works from /, runs as 10005 and exposes 8080", () => {
    const stage = lastStage("images/web/Dockerfile", /^FROM caddy:[^@\s]+@sha256:[0-9a-f]{64}/);

    expect(stage).not.toBe("");
    expect(stage).toMatch(/^RUN setcap -r \/usr\/bin\/caddy$/m);
    expect(stage).toMatch(/^WORKDIR \/$/m);
    expect(stage).toMatch(/^USER 10005:10005$/m);
    expect(stage).toMatch(/^EXPOSE 8080$/m);
  });

  it.each([
    ["images/web/Dockerfile"],
    ["images/server/Dockerfile"],
    ["images/postgres/Dockerfile"],
  ])("TP-15.33/TP-15.34 (A-417): %s has no # syntax= line", (rel) => {
    expect(read(rel)).not.toMatch(/^#\s*syntax\s*=/m);
  });

  it("TP-15.33: the Caddyfile has exactly one site block, :8080, and global auto_https off and admin off", () => {
    const { global, sites } = caddyBlocks();

    expect(sites).toEqual([":8080"]);
    expect(global).toMatch(/^\s*auto_https\s+off\s*$/m);
    expect(global).toMatch(/^\s*admin\s+off\s*$/m);
  });

  it("TP-15.33 (A-419): @maint file has root / and try_files /srv/maintenance/on, one directive per line", () => {
    expect(read("infra/local/Caddyfile")).toMatch(
      /@maint\s+file\s*\{\s*\n\s*root\s+\/\s*\n\s*try_files\s+\/srv\/maintenance\/on\s*\n\s*\}/,
    );
  });
});

// A-417, A-418: the Postgres image.
describe("TP-15.34: the Postgres image (A-417, A-418)", () => {
  it("TP-15.34: the Dockerfile copies cluster-bootstrap.sql from the sql context and sets PGDATABASE=postgres", () => {
    const docker = read("images/postgres/Dockerfile");

    expect(docker).toMatch(
      /^COPY --from=sql cluster-bootstrap\.sql \/docker-entrypoint-initdb\.d\/10-budmon\.sql\.tpl$/m,
    );
    expect(docker).toMatch(/^ENV PGDATABASE=postgres$/m);
  });

  it("TP-15.34: the entrypoint passes -c listen_addresses=${BUDMON_LISTEN_ADDRESSES:-}", () => {
    // Quoted or not.
    expect(read("images/postgres/budmon-entrypoint.sh")).toMatch(
      /-c\s+"?listen_addresses=\$\{BUDMON_LISTEN_ADDRESSES:-\}"?(\s|$)/,
    );
  });

  it("TP-15.34: postgresql.conf has no uncommented listen_addresses line", () => {
    const lines = read("infra/local/postgres/postgresql.conf")
      .split("\n")
      .map((l) => l.trim());

    expect(lines.filter((l) => /^listen_addresses\b/.test(l))).toEqual([]);
  });
});

// A-391, A-417, A-424: the changes and infra-int jobs.
describe("TP-15.35: ci.yml's changes and infra-int jobs", () => {
  interface Step {
    run?: unknown;
  }
  interface Job {
    needs?: unknown;
    if?: unknown;
    "timeout-minutes"?: unknown;
    outputs?: Record<string, unknown>;
    steps?: Step[];
  }
  const jobs = () =>
    (parse(read(".github/workflows/ci.yml")) as { jobs?: Record<string, Job> }).jobs ?? {};
  const cond = (job: Job | undefined) => (typeof job?.if === "string" ? job.if : "");
  const runs = (job: Job | undefined) =>
    (job?.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : "")).join("\n");

  it("TP-15.35: infra-int needs changes; its if reads the infra output or a release/hotfix head branch; timeout 30", () => {
    const job = jobs()["infra-int"];
    const text = cond(job);

    expect([job?.needs].flat()).toContain("changes");
    expect(text).toContain("needs.changes.outputs.infra == 'true'");
    expect(text).toContain("startsWith(github.head_ref, 'release/')");
    expect(text).toContain("startsWith(github.head_ref, 'hotfix/')");
    expect(job?.["timeout-minutes"]).toBe(30);
  });

  it("TP-15.35 (A-424): changes outputs infra, infra-lint and android", () => {
    expect(Object.keys(jobs()["changes"]?.outputs ?? {})).toEqual(
      expect.arrayContaining(["infra", "infra-lint", "android"]),
    );
  });

  it.each([
    ["infra", ["infra/", "images/", "apps/server/", ".dockerignore", ".github/workflows/ci.yml"]],
    ["infra-lint", ["infra/", "images/", "tools/ci/", ".github/"]],
  ] as const)("TP-15.35 (A-424): the %s line lists exactly %j", (name, paths) => {
    expect(outputAlternatives(ROOT, name)?.sort()).toEqual([...paths].sort());
  });

  it("TP-15.35 (A-424): infra-lint's if reads needs.changes.outputs.infra-lint == 'true'", () => {
    expect(cond(jobs()["infra-lint"])).toContain("needs.changes.outputs.infra-lint == 'true'");
  });

  it("TP-15.35 (A-393, A-417): infra-int builds server and web from the root, postgres with the sql context, before pnpm test:infra", () => {
    const text = runs(jobs()["infra-int"]).replace(/\\\n\s*/g, " ");
    const builds = text.split("\n").filter((l) => /docker build/.test(l));
    const at = (pattern: RegExp) => {
      const line = builds.find((l) => pattern.test(l));
      return line === undefined ? -1 : text.indexOf(line);
    };

    for (const n of ["server", "web"]) {
      const line = builds.find((l) => l.includes(`-f images/${n}/Dockerfile`)) ?? "";
      expect(line.split(/\s+/), n).toContain(".");
    }
    const pg = builds.find((l) => /images\/postgres\/?(\s|$)/.test(l)) ?? "";
    expect(pg).toContain("--build-context sql=apps/server/src/platform/db/sql");
    expect(pg.trim().split(/\s+/).at(-1)).toMatch(/^images\/postgres\/?$/);
    const test = text.indexOf("pnpm test:infra");
    expect(test).toBeGreaterThan(
      Math.max(at(/images\/server\//), at(/images\/web\//), at(/images\/postgres/)),
    );
  });

  it("TP-15.35 (A-393): the root .dockerignore lists the eight entries", () => {
    const lines = read(".dockerignore")
      .split("\n")
      .map((l) => l.trim());

    for (const p of [
      "**/node_modules",
      ".git",
      ".data",
      ".tools",
      ".claude",
      "**/dist",
      "apps/android",
      "docs",
    ]) {
      expect(lines).toContain(p);
    }
  });
});
