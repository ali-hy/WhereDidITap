// The privacy canary suite (identity LLD §10.1). TP-3.27: signing in with a canary email and a
// canary password (wrong, then right, with a canary device model), with body delivery and with
// cookie delivery (web header), then refreshing each, through the real HTTP layer. Logs, spans,
// metrics, error reports and the jobs' data and output hold no canary and none of the bma_ / bmr_
// tokens the calls issued (A-84).
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

type Tokens = { tokens: { accessToken: string; refreshToken: string } };

describe("TP-3.27: sign-in and refresh leak no canary", () => {
  it("TP-3.27: a wrong and a right canary password for a canary email, by body and by cookie delivery, then a refresh of each: nothing captured holds a canary or an issued token", async () => {
    const { userFactory, passwordFactory } = await import("../factories/identity.js");
    const { call } = await import("../support/identityHttp.js");
    const { cookieHeader, cookieJar } = await import("../support/identity.js");
    if (api === undefined) throw new Error("the API wasn't built");
    const built = api;
    const h = built.testDb.database.handle;
    const user = await userFactory(h, { email: CANARIES.email, displayName: CANARIES.payee });
    await passwordFactory(
      h,
      user.id,
      await built.container.identity.deps.hasher.hash(CANARY_PASSWORD),
    );
    const WEB = { client: "web/1" };
    const signIn = (password: string, delivery: "body" | "cookie") =>
      call(
        built.app,
        "POST",
        "/auth/sign-in",
        { email: CANARIES.email, password, tokenDelivery: delivery, deviceModel: CANARIES.payee },
        delivery === "cookie" ? WEB : {},
      );

    // Body delivery: wrong, right, refresh.
    const wrong = await signIn(`${CANARIES.message} wrong one`, "body");
    const right = await signIn(CANARY_PASSWORD, "body");
    const bodyTokens = (right.json() as Tokens).tokens;
    const refreshed = await call(built.app, "POST", "/auth/refresh", {
      tokenDelivery: "body",
      refreshToken: bodyTokens.refreshToken,
    });
    const refreshedTokens = (refreshed.json() as Tokens).tokens;

    // Cookie delivery with the web header: wrong, right, refresh.
    const wrongCookie = await signIn(`${CANARIES.message} wrong two`, "cookie");
    const rightCookie = await signIn(CANARY_PASSWORD, "cookie");
    const jar = cookieJar(rightCookie);
    const refreshedCookie = await call(
      built.app,
      "POST",
      "/auth/refresh",
      { tokenDelivery: "cookie" },
      {
        ...WEB,
        headers: {
          cookie: cookieHeader({ "__Secure-budmon_rt": jar["__Secure-budmon_rt"] ?? "" }),
        },
      },
    );
    const refreshedJar = cookieJar(refreshedCookie);
    await shutdown();

    // The requests ran as intended.
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(200);
    expect(refreshed.status).toBe(200);
    expect(wrongCookie.status).toBe(401);
    expect(rightCookie.status).toBe(200);
    expect(refreshedCookie.status).toBe(200);

    // Every bma_ / bmr_ token the calls issued (A-84), each distinct.
    const issued = [
      bodyTokens.accessToken,
      bodyTokens.refreshToken,
      refreshedTokens.accessToken,
      refreshedTokens.refreshToken,
      jar["__Secure-budmon_at"] ?? "",
      jar["__Secure-budmon_rt"] ?? "",
      refreshedJar["__Secure-budmon_at"] ?? "",
      refreshedJar["__Secure-budmon_rt"] ?? "",
    ];
    for (const token of issued) expect(token).toMatch(/^bm[ar]_[A-Za-z0-9_-]{43}$/);
    expect(new Set(issued).size).toBe(issued.length);

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
    const tokenHits = sources.flatMap((source) =>
      issued.flatMap((token, i) =>
        source.text.includes(token) ? [{ source: source.name, token: i }] : [],
      ),
    );
    expect(tokenHits).toEqual([]);
  }, 120_000);
});
