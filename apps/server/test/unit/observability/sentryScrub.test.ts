// F-35 scrubSentryEvent and scrubBreadcrumb. TP-3.5, plus extra cases TP-3.24x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// A-101: every exception value is replaced by its type unless it has the error-key format
// (^[A-Z][A-Z0-9_]{1,63}$), so the bare, token-shaped canary is replaced too. A-103: a kept
// breadcrumb has exactly category, timestamp, type, level and data.{url, method, status_code}.
// A-110: frames are re-checked (function and reduced filename patterns). A-112: tags.route loses
// its query, and context values failing F-30's rules (user.id holding an email) are dropped.
import { CANARIES, scanForCanaries } from "@budmon/test-support";
import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubSentryEvent } from "../../../src/platform/observability/sentry.js";

const MESSAGE_VALUE = `duplicate key for ${CANARIES.message} (${CANARIES.email})`;

function rawEvent(value: string = CANARIES.message): Record<string, unknown> {
  return {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 1_760_000_000,
    platform: "node",
    level: "error",
    release: "v1.2.3",
    environment: "production",
    server_name: "laptop-host",
    message: CANARIES.message,
    request: { url: `https://x.io/a?token=${CANARIES.token}`, data: CANARIES.payee },
    extra: { payee: CANARIES.payee },
    user: {
      id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
      email: CANARIES.email,
      ip_address: "10.1.2.3",
    },
    // A-112: the route tag loses its query.
    tags: {
      route: `/v1/entries/{id}?token=${CANARIES.token}`,
      job: "fx.fetch",
      foo: CANARIES.payee,
    },
    exception: {
      values: [
        {
          type: "DatabaseError",
          value,
          mechanism: { type: "generic", data: { x: CANARIES.token } },
          stacktrace: {
            frames: [
              {
                filename: "node_modules/fastify/lib/route.js",
                function: "handler",
                lineno: 10,
                colno: 5,
                in_app: true,
                vars: { password: CANARIES.token },
                context_line: `const x = "${CANARIES.payee}"`,
                pre_context: [CANARIES.email],
              },
              // A-110: a function name carrying a canary is dropped with its frame.
              {
                filename: "node_modules/fastify/lib/route.js",
                function: `x ${CANARIES.payee} y`,
                lineno: 11,
                colno: 1,
                in_app: true,
              },
              // A-110: an absolute path outside the repository becomes <unknown>.
              {
                filename: "/home/u/secret/x.js",
                function: "inner",
                lineno: 3,
                colno: 4,
                in_app: true,
              },
            ],
          },
        },
        // A-101: an error key is kept.
        { type: "BudmonError", value: "NOT_FOUND" },
      ],
    },
    contexts: {
      trace: { trace_id: "t".repeat(32), span_id: "s".repeat(16), op: CANARIES.message },
      os: { name: "linux" },
    },
    breadcrumbs: {
      values: [
        {
          category: "console",
          message: CANARIES.message,
          timestamp: 1,
          level: "info",
          type: "default",
        },
        {
          category: "http",
          type: "http",
          level: "info",
          timestamp: 2,
          message: CANARIES.message,
          data: {
            url: `https://api.example.com/v1/x?token=${CANARIES.token}#f`,
            method: "GET",
            status_code: 200,
            body: CANARIES.payee,
          },
        },
      ],
    },
  };
}

function noCanary(value: unknown): void {
  expect(scanForCanaries([{ name: "event", text: JSON.stringify(value) }], CANARIES)).toEqual([]);
}

describe("TP-3.5: scrubSentryEvent", () => {
  it("TP-3.5: keeps only the allowlisted keys; the canary value becomes the type, NOT_FOUND stays, the http breadcrumb keeps its category", () => {
    expect(scrubSentryEvent(rawEvent())).toEqual({
      event_id: "0123456789abcdef0123456789abcdef",
      timestamp: 1_760_000_000,
      platform: "node",
      level: "error",
      release: "v1.2.3",
      environment: "production",
      exception: {
        values: [
          {
            type: "DatabaseError",
            value: "DatabaseError",
            stacktrace: {
              frames: [
                {
                  filename: "node_modules/fastify/lib/route.js",
                  function: "handler",
                  lineno: 10,
                  colno: 5,
                  in_app: true,
                },
                {
                  filename: "<unknown>",
                  function: "inner",
                  lineno: 3,
                  colno: 4,
                  in_app: true,
                },
              ],
            },
          },
          { type: "BudmonError", value: "NOT_FOUND" },
        ],
      },
      tags: { route: "/v1/entries/{id}", job: "fx.fetch" },
      user: { id: "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a0b" },
      contexts: { trace: { trace_id: "t".repeat(32), span_id: "s".repeat(16) } },
      breadcrumbs: [
        {
          category: "http",
          type: "http",
          level: "info",
          timestamp: 2,
          data: { url: "https://api.example.com/v1/x", method: "GET", status_code: 200 },
        },
      ],
    });
  });

  it("TP-3.5: a user.id holding an email is dropped (A-112)", () => {
    const event = { ...rawEvent(), user: { id: CANARIES.email } };

    const scrubbed = scrubSentryEvent(event) ?? {};

    expect((scrubbed["user"] as Record<string, unknown> | undefined)?.["id"]).toBeUndefined();
    noCanary(scrubbed);
  });

  it("TP-3.5: no canary survives", () => {
    noCanary(scrubSentryEvent(rawEvent()));
  });

  it("TP-3.5: the input event isn't changed in place", () => {
    const event = rawEvent();
    const before = JSON.stringify(event);

    scrubSentryEvent(event);

    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("TP-3.24x: scrubSentryEvent and scrubBreadcrumb, further cases (F-35)", () => {
  it("TP-3.24x: a real message holding the canary is replaced by the type", () => {
    const scrubbed = scrubSentryEvent(rawEvent(MESSAGE_VALUE)) as {
      exception: { values: { type: unknown; value: unknown }[] };
    };

    expect(scrubbed.exception.values[0]).toMatchObject({
      type: "DatabaseError",
      value: "DatabaseError",
    });
    noCanary(scrubbed);
  });

  it.each([["fx.fetch"], ["not_found"], ["CONNECTION-RESET"], ["A"], [`A${"B".repeat(64)}`]])(
    "TP-3.24x: %j, not in the error-key format, is replaced by the type (A-101)",
    (value) => {
      const scrubbed = scrubSentryEvent(rawEvent(value)) as {
        exception: { values: { value: unknown }[] };
      };

      expect(scrubbed.exception.values[0]?.value).toBe("DatabaseError");
    },
  );

  it.each([["AB"], [`A${"B".repeat(63)}`], ["RATE_LIMITED"], ["E2"]])(
    "TP-3.24x: %j, in the error-key format, is kept (A-101)",
    (value) => {
      const scrubbed = scrubSentryEvent(rawEvent(value)) as {
        exception: { values: { value: unknown }[] };
      };

      expect(scrubbed.exception.values[0]?.value).toBe(value);
    },
  );

  it("TP-3.24x: tags keep only route, job, client_kind, error_key and request_id (A-122)", () => {
    const event = {
      ...rawEvent(),
      tags: {
        route: "/a",
        job: "platform.fx-rates-fetch",
        client_kind: "web",
        error_key: "NOT_FOUND",
        request_id: "0123456789abcdef0123456789abcdef",
        other: "x",
      },
    };

    expect((scrubSentryEvent(event) as { tags: unknown }).tags).toEqual({
      route: "/a",
      job: "platform.fx-rates-fetch",
      client_kind: "web",
      error_key: "NOT_FOUND",
      request_id: "0123456789abcdef0123456789abcdef",
    });
  });

  it.each([["r1"], [CANARIES.payee], ["0123456789ABCDEF0123456789ABCDEF"], ["0".repeat(33)]])(
    "TP-3.24x: a request_id tag %j that isn't 32 lowercase hex is dropped (A-122)",
    (requestId) => {
      const event = { ...rawEvent(), tags: { route: "/a", request_id: requestId } };

      expect((scrubSentryEvent(event) as { tags: unknown }).tags).toEqual({ route: "/a" });
    },
  );

  it.each([["console"], ["query"], ["ui.click"], ["sentry.event"]])(
    "TP-3.24x: a %s breadcrumb is removed",
    (category) => {
      expect(scrubBreadcrumb({ category, message: CANARIES.message, timestamp: 1 })).toBeNull();
    },
  );

  it("TP-3.24x: a navigation breadcrumb keeps its category, timestamp, type, level and the reduced URL (A-103)", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        type: "navigation",
        level: "info",
        timestamp: 3,
        message: CANARIES.message,
        data: {
          url: `http://localhost:5173/entries?payee=${CANARIES.payee}`,
          from: CANARIES.email,
        },
      }),
    ).toEqual({
      category: "navigation",
      type: "navigation",
      level: "info",
      timestamp: 3,
      data: { url: "http://localhost:5173/entries" },
    });
  });

  it("TP-3.24x: an http breadcrumb without method or status keeps only what's present (A-103)", () => {
    expect(
      scrubBreadcrumb({ category: "http", timestamp: 4, data: { url: "https://x.io/a?b=1" } }),
    ).toEqual({ category: "http", timestamp: 4, data: { url: "https://x.io/a" } });
  });

  it("TP-3.24x: an http breadcrumb with an unparseable URL keeps no URL text", () => {
    const crumb = scrubBreadcrumb({
      category: "http",
      timestamp: 1,
      data: { url: `not a url ${CANARIES.token}`, method: "POST", status_code: 500 },
    });

    noCanary(crumb);
  });
});

describe("TP-3.5: Sentry 11 breadcrumbs as an array (A-134)", () => {
  it("TP-3.5: the http breadcrumb is kept in an array; the console one is gone", () => {
    const raw = rawEvent();
    const values = (raw["breadcrumbs"] as { values: unknown[] }).values;
    const event = { ...raw, breadcrumbs: values };

    const scrubbed = scrubSentryEvent(event) ?? {};

    expect(scrubbed["breadcrumbs"]).toEqual([
      {
        category: "http",
        type: "http",
        level: "info",
        timestamp: 2,
        data: { url: "https://api.example.com/v1/x", method: "GET", status_code: 200 },
      },
    ]);
    noCanary(scrubbed);
  });

  it("TP-3.24x: breadcrumbs given as { values } still come out as an array (A-134)", () => {
    const scrubbed = scrubSentryEvent(rawEvent()) ?? {};

    expect(Array.isArray(scrubbed["breadcrumbs"])).toBe(true);
  });
});

describe("TP-3.5: error_code and http_status tags (A-137)", () => {
  it("TP-3.5: error_code 23505 and http_status 503 are kept", () => {
    const event = { ...rawEvent(), tags: { route: "/a", error_code: "23505", http_status: 503 } };

    const tags = (scrubSentryEvent(event) ?? {})["tags"] as Record<string, unknown>;

    expect(tags["error_code"]).toBe("23505");
    expect(String(tags["http_status"])).toBe("503");
  });

  it("TP-3.5: error_code 'bad code' is dropped", () => {
    const event = { ...rawEvent(), tags: { route: "/a", error_code: "bad code" } };

    const tags = (scrubSentryEvent(event) ?? {})["tags"] as Record<string, unknown>;

    expect(tags).not.toHaveProperty("error_code");
  });

  it.each([["ECONNREFUSED"], ["57P01"]])("TP-3.24x: error_code %s is kept", (code) => {
    const tags = (scrubSentryEvent({ ...rawEvent(), tags: { error_code: code } }) ?? {})[
      "tags"
    ] as Record<string, unknown>;

    expect(tags["error_code"]).toBe(code);
  });

  it.each([[99], [600], ["abc"], [CANARIES.amountMinor]])(
    "TP-3.24x: http_status %o is dropped",
    (status) => {
      const tags = (scrubSentryEvent({ ...rawEvent(), tags: { http_status: status } }) ?? {})[
        "tags"
      ] as Record<string, unknown> | undefined;

      expect(tags ?? {}).not.toHaveProperty("http_status");
    },
  );
});
