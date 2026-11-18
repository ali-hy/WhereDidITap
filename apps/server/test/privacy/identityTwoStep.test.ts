// The privacy canary suite (identity LLD §10.1). TP-4.15: a canary user turns two-step on (setup,
// enable), signs in with a TOTP code and with a recovery code, confirms with another recovery
// code and regenerates the codes, through the real HTTP layer. Logs, spans, metrics, error
// reports and the jobs' data and output hold no canary, no form of the TOTP secret, no recovery
// code and no TOTP code the calls used.
import { createRequire } from "node:module";
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdentityApi } from "../support/identity.js";
import type { InMemoryTelemetry } from "../support/telemetry.js";

let telemetry: InMemoryTelemetry;
let shutdown: () => Promise<void>;
let api: IdentityApi | undefined;

/** 17 + 9 characters, not common, without the email's local part. */
const CANARY_PASSWORD = `${CANARIES.message} long pass`;

beforeAll(async () => {
  const { inMemoryTelemetry } = await import("../support/telemetry.js");
  telemetry = inMemoryTelemetry();
  const { startTelemetry } = await import("../../src/platform/observability/otel.js");
  const started = startTelemetry(
    { service: "api", release: "v1.2.3", environment: "test" },
    {
      onDrop: vi.fn(),
      traceExporter: telemetry.traceExporter,
      metricReader: telemetry.metricReader,
    },
  );
  let stopped: Promise<void> | undefined;
  shutdown = () => (stopped ??= started.shutdown());
  createRequire(import.meta.url)("pg");

  const { buildIdentityApi } = await import("../support/identity.js");
  api = await buildIdentityApi();
  await api.container.boss.start();
}, 120_000);

afterAll(async () => {
  await api?.close();
  await shutdown();
});

describe("TP-4.15: two-step leaks no code or secret", () => {
  it("TP-4.15: enable, verify (TOTP and recovery code), confirm and regenerate: nothing captured holds a canary, the secret, a recovery code or a used TOTP code", async () => {
    const { userFactory, passwordFactory } = await import("../factories/identity.js");
    const { call, errorOf } = await import("../support/identityHttp.js");
    const { cookieHeader, cookieJar } = await import("../support/identity.js");
    const { base32ToBytes, codeAt } = await import("../support/totp.js");
    if (api === undefined) throw new Error("the API wasn't built");
    const built = api;
    const h = built.testDb.database.handle;
    const now = built.clock.now();
    const user = await userFactory(h, { email: CANARIES.email, displayName: CANARIES.payee });
    await passwordFactory(
      h,
      user.id,
      await built.container.identity.deps.hasher.hash(CANARY_PASSWORD),
    );
    const WEB = { client: "web/1" };
    const signIn = (delivery: "body" | "cookie") =>
      call(
        built.app,
        "POST",
        "/auth/sign-in",
        { email: CANARIES.email, password: CANARY_PASSWORD, tokenDelivery: delivery },
        delivery === "cookie" ? WEB : {},
      );
    const as = (accessToken: string) => ({ headers: { authorization: `Bearer ${accessToken}` } });

    // Signed in without two-step (the session is confirmed at sign-in).
    const first = await signIn("body");
    const firstToken = (first.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    // Setup and enable.
    const setup = await call(built.app, "POST", "/me/two-step/setup", {}, as(firstToken));
    const secretText = (setup.json() as { secret: string }).secret;
    const secret = base32ToBytes(secretText);
    const enableCode = codeAt(secret, now);
    const enable = await call(
      built.app,
      "POST",
      "/me/two-step/enable",
      { code: enableCode },
      as(firstToken),
    );
    const firstCodes = (enable.json() as { recoveryCodes: string[] }).recoveryCodes;

    // Verify with a TOTP code (body), then with a recovery code (cookie, web header).
    const challenge = (
      (await signIn("body")).json() as {
        challengeToken: string;
      }
    ).challengeToken;
    const verifyCode = codeAt(secret, now, 1);
    const verified = await call(built.app, "POST", "/auth/two-step/verify", {
      challengeToken: challenge,
      code: verifyCode,
      tokenDelivery: "body",
    });
    const tokens = (verified.json() as { tokens: { accessToken: string; refreshToken: string } })
      .tokens;
    const cookieChallenge = cookieJar(await signIn("cookie"))["__Secure-budmon_2fa"] ?? "";
    const verifiedByRecovery = await call(
      built.app,
      "POST",
      "/auth/two-step/verify",
      { recoveryCode: firstCodes[0], tokenDelivery: "cookie" },
      { ...WEB, headers: { cookie: cookieHeader({ "__Secure-budmon_2fa": cookieChallenge }) } },
    );
    // A wrong recovery code, then a right one, at me.confirm.
    const wrongConfirm = await call(
      built.app,
      "POST",
      "/me/confirm",
      { recoveryCode: `${CANARIES.message}AB` },
      as(tokens.accessToken),
    );
    const confirmed = await call(
      built.app,
      "POST",
      "/me/confirm",
      { recoveryCode: firstCodes[1] },
      as(tokens.accessToken),
    );

    // Regenerate.
    const regenerated = await call(
      built.app,
      "POST",
      "/me/two-step/recovery-codes",
      {},
      as(tokens.accessToken),
    );
    const secondCodes = (regenerated.json() as { recoveryCodes: string[] }).recoveryCodes;
    await shutdown();

    // The requests ran as intended.
    expect(first.status).toBe(200);
    expect(setup.status).toBe(200);
    expect(enable.status).toBe(200);
    expect(firstCodes).toHaveLength(10);
    expect(verified.status).toBe(200);
    expect(verifiedByRecovery.status).toBe(200);
    expect(errorOf(wrongConfirm).code).toBe("TWO_STEP_CODE_INVALID");
    expect(confirmed.status).toBe(200);
    expect(regenerated.status).toBe(200);
    expect(secondCodes).toHaveLength(10);

    const jobs = (
      await h.executeSql("SELECT name, data, output FROM pgboss.job WHERE name LIKE 'identity.%'")
    ).rows;
    const sources = [
      { name: "logs", text: built.obs.capture.lines().join("\n") },
      { name: "reports", text: JSON.stringify(built.obs.reporter.events) },
      {
        name: "spans",
        text: JSON.stringify(
          telemetry.traceExporter.spans.map((s) => ({
            name: s.name,
            attributes: s.attributes,
            events: s.events,
            status: s.status,
          })),
        ),
      },
      { name: "metrics", text: telemetry.metricsText() },
      {
        name: "container metrics",
        text: JSON.stringify([...(await built.obs.collect()).values()]),
      },
      { name: "jobs", text: JSON.stringify(jobs) },
    ];
    expect(scanForCanaries(sources, CANARIES)).toEqual([]);

    // Long values: the secret in every form, each recovery code, the challenge and session tokens.
    const ungrouped = secretText.replace(/\s+/g, "");
    const secrets = [
      ungrouped,
      ungrouped.toLowerCase(),
      secretText,
      secret.toString("hex"),
      secret.toString("base64").replace(/=+$/, ""),
      secret.toString("base64url"),
    ];
    const codes = [...firstCodes, ...secondCodes].flatMap((c) => [c, c.replaceAll("-", "")]);
    const tokensUsed = [challenge, cookieChallenge, tokens.accessToken, tokens.refreshToken];
    const long = [...secrets, ...codes, ...tokensUsed];
    const longHits = sources.flatMap((source) =>
      long.flatMap((value) =>
        value.length > 0 && source.text.includes(value) ? [{ source: source.name, value }] : [],
      ),
    );
    expect(longHits).toEqual([]);

    // Six-digit TOTP codes, as standalone numbers (not inside a longer run of letters or digits).
    const totpHits = sources.flatMap((source) =>
      [enableCode, verifyCode].flatMap((code) =>
        new RegExp(`(?<![0-9A-Za-z])${code}(?![0-9A-Za-z])`).test(source.text)
          ? [{ source: source.name, code }]
          : [],
      ),
    );
    expect(totpHits).toEqual([]);
  }, 120_000);
});
