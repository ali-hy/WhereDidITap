// The rehearsal's platform canary flows (F-195 step 7, A-445), run by the harness against the
// rehearsal stack through Caddy. Each flow sends canaries where the platform must not echo or log
// them; every API response body is checked here, and step 8 then scans every log source. TP-16.5.
// Environment (set by the harness): REHEARSAL_BASE_URL, REHEARSAL_HOST, REHEARSAL_FX_CONTROL_URL,
// REHEARSAL_COMPOSE_MAIN (a JSON array of `docker` arguments for the main project).
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, describe, expect, it } from "vitest";

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};
const BASE = env("REHEARSAL_BASE_URL");
const HOST = env("REHEARSAL_HOST");
const FX_CONTROL = env("REHEARSAL_FX_CONTROL_URL");
const COMPOSE_MAIN = JSON.parse(env("REHEARSAL_COMPOSE_MAIN")) as string[];
const FAIL_DATE = "2024-03-05"; // REHEARSAL_FX_FAIL_DATE (F-193)

interface Reply {
  status: number;
  body: string;
}

/** One request with node:http; Host is Caddy's, and every POST carries the app's Origin. */
function send(
  base: string,
  method: "GET" | "POST",
  path: string,
  body?: { type: string; text: string },
  host: string | null = HOST,
): Promise<Reply> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: {
          ...(host === null ? {} : { Host: host }),
          ...(method === "POST" && host !== null ? { Origin: "http://localhost:8080" } : {}),
          ...(body === undefined ? {} : { "Content-Type": body.type }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: text });
        });
      },
    );
    req.on("error", reject);
    req.end(body?.text);
  });
}

const api = (method: "GET" | "POST", path: string, body?: { type: string; text: string }) =>
  send(BASE, method, path, body);
const fx = (method: "GET" | "POST", path: string, body?: unknown) =>
  send(
    FX_CONTROL,
    method,
    path,
    body === undefined ? undefined : { type: "application/json", text: JSON.stringify(body) },
    null,
  );

/** The response holds no canary in any form F-198 searches. */
function expectNoCanary(name: string, r: Reply) {
  expect(scanForCanaries([{ name, text: r.body }], CANARIES), name).toEqual([]);
}

interface Envelope {
  code?: string;
  data?: { issues?: { path?: unknown[]; code?: string }[] };
}
const envelope = (r: Reply) => JSON.parse(r.body) as Envelope;
const json = (value: unknown) => ({ type: "application/json", text: JSON.stringify(value) });
const enc = encodeURIComponent;

describe("TP-16.5: platform canary flows (A-445)", () => {
  it("TP-16.5 F1: malformed JSON with canaries → 400 VALIDATION_FAILED invalid_json, no canary echoed", async () => {
    const r = await api("POST", "/api/v1/meta/client-config", {
      type: "application/json",
      text: `{"payee":"${CANARIES.payee}","token":"${CANARIES.token}",`,
    });

    expect(r.status).toBe(400);
    expect(envelope(r).code).toBe("VALIDATION_FAILED");
    expect(envelope(r).data?.issues?.[0]?.code).toBe("invalid_json");
    expectNoCanary("F1", r);
  });

  it("TP-16.5 F2: a valid JSON body with canaries on a GET-only procedure → 404 NOT_FOUND", async () => {
    const r = await api(
      "POST",
      "/api/v1/meta/client-config",
      json({ payee: CANARIES.payee, amountMinor: CANARIES.amountMinor, email: CANARIES.email }),
    );

    expect(r.status).toBe(404);
    expect(envelope(r).code).toBe("NOT_FOUND");
    expectNoCanary("F2", r);
  });

  it("TP-16.5 F3: a text/plain body with canaries → 400 VALIDATION_FAILED unsupported_media_type", async () => {
    const r = await api("POST", "/api/v1/meta/client-config", {
      type: "text/plain",
      text: `${CANARIES.message} ${CANARIES.token}`,
    });

    expect(r.status).toBe(400);
    expect(envelope(r).code).toBe("VALIDATION_FAILED");
    expect(envelope(r).data?.issues?.[0]?.code).toBe("unsupported_media_type");
    expectNoCanary("F3", r);
  });

  it("TP-16.5 F4: canaries in query strings: a procedure 200, an unmatched API path 404 NOT_FOUND, the SPA 200", async () => {
    const proc = await api(
      "GET",
      `/api/v1/meta/client-config?email=${enc(CANARIES.email)}&token=${enc(CANARIES.token)}`,
    );
    const unmatched = await api("GET", `/api/v1/no-such-route?token=${enc(CANARIES.token)}`);
    const spa = await api("GET", `/?token=${enc(CANARIES.token)}`);

    expect(proc.status).toBe(200);
    expect(unmatched.status).toBe(404);
    expect(envelope(unmatched).code).toBe("NOT_FOUND");
    expect(spa.status).toBe(200);
    expectNoCanary("F4 procedure", proc);
    expectNoCanary("F4 unmatched", unmatched);
    expectNoCanary("F4 spa", spa);
  });

  it("TP-16.5 F5: a field failing validation (payee as email) → 400 VALIDATION_FAILED with path [email]; skipped before identity", async (ctx) => {
    const r = await api(
      "POST",
      "/api/v1/auth/password-reset/request",
      json({ email: CANARIES.payee }),
    );
    if (r.status === 404 && envelope(r).code === "NOT_FOUND") {
      ctx.skip();
      return;
    }

    expect(r.status).toBe(400);
    expect(envelope(r).code).toBe("VALIDATION_FAILED");
    expect(envelope(r).data?.issues?.some((i) => JSON.stringify(i.path) === '["email"]')).toBe(
      true,
    );
    expectNoCanary("F5", r);
  });

  describe("TP-16.5 F6: an FX backfill failing on fake FX's canary 500", () => {
    afterAll(async () => {
      await fx("POST", "/__control", { mode: "ok" });
    });

    it("TP-16.5 F6: control 200; fx:backfill exits 0 with {enqueued:true}; fake FX counts ≥ 3 requests for the date within 90 s", async () => {
      const control = await fx("POST", "/__control", { mode: "server_error", date: FAIL_DATE });
      expect(control.status, control.body).toBe(200);

      const cli = spawnSync(
        "docker",
        [
          ...COMPOSE_MAIN,
          "exec",
          "-T",
          "worker-general",
          "node",
          "dist/main/cli.js",
          "fx:backfill",
          "--date",
          FAIL_DATE,
        ],
        { encoding: "utf8", env: process.env, timeout: 60_000 },
      );
      expect(cli.status, cli.stderr).toBe(0);
      expect(
        cli.stdout
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as unknown),
      ).toEqual([{ enqueued: true }]);

      const deadline = Date.now() + 90_000;
      let count = 0;
      while (Date.now() < deadline) {
        const r = await fx("GET", `/__control/hits?date=${FAIL_DATE}`);
        count = (JSON.parse(r.body) as { count: number }).count;
        if (count >= 3) break;
        await new Promise((res) => setTimeout(res, 1_000));
      }
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });
});
