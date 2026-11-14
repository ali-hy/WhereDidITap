// F-217 with the real SDK (A-502 (1), QA Q-F1): initWebSentry sends error events only. No session
// on load, navigation or hide, no client report, and nothing carrying the browser's user agent;
// one deliberate error gives exactly one envelope holding only an `event` item. `fetch` is a
// recorder, so nothing leaves the test. This file doesn't mock @sentry/solid. TP-11.36.
import * as Sentry from "@sentry/solid";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadSentry } from "../support/s11b.js";

const CANARY = "CANARY-web-tp-11-36-7f3a";

interface Recorded {
  url: string;
  body: string;
}

const recorded: Recorded[] = [];

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return String(body);
}

function hide(): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The `type` of every item header in an envelope (newline-delimited: header, then item pairs). */
function itemTypes(body: string): unknown[] {
  const lines = body.split("\n").filter((l) => l !== "");
  const types: unknown[] = [];
  for (let i = 1; i < lines.length; i += 2) {
    const header = JSON.parse(lines[i] ?? "{}") as { type?: unknown };
    types.push(header.type);
  }
  return types;
}

afterAll(async () => {
  await Sentry.close();
  vi.unstubAllGlobals();
});

describe("TP-11.36: the real web SDK sends error events only (F-217, A-502 (1))", () => {
  it("TP-11.36: nothing before the error; then one envelope with only an event item, no user agent, canary, IP or client report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: { body?: unknown }) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
        recorded.push({ url, body: bodyText(init?.body) });
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
    );
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => `BudmonUA/${CANARY}`,
    });
    const { initWebSentry } = await loadSentry();

    initWebSentry({
      dsn: "https://k@sentry.invalid/2",
      release: "web@7",
      environment: "production",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    history.pushState({}, "", "/x");
    hide();
    await Sentry.flush(2000);

    expect(recorded.map((r) => r.url)).toEqual([]);

    Sentry.captureException(new Error(CANARY));
    await Sentry.flush(2000);
    hide();
    await Sentry.flush(2000);

    expect(recorded).toHaveLength(1);
    const [envelope] = recorded;
    expect(envelope?.url.startsWith("https://sentry.invalid/api/2/envelope/")).toBe(true);
    const body = envelope?.body ?? "";
    expect(itemTypes(body)).toEqual(["event"]);
    expect(body).not.toContain("user_agent");
    expect(body.toLowerCase()).not.toContain("user-agent");
    for (const banned of ["BudmonUA", CANARY, "ip_address", "client_report"]) {
      expect(body, banned).not.toContain(banned);
    }
  }, 15_000);
});
