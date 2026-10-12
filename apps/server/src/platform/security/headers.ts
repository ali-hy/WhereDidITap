// F-61 security headers and F-62 body handling (delivered in S-4, A-124).
import helmet from "@fastify/helmet";
import type { FastifyError, FastifyInstance } from "fastify";
import secureJson from "secure-json-parse";
import type { ErrorReporter } from "../observability/errorReporter.js";
import type { Logger } from "../observability/logger.js";

/** F-61. helmet's other defaults stay on (A-151): COOP same-origin, Origin-Agent-Cluster,
 * X-DNS-Prefetch-Control off, X-Download-Options noopen, X-Frame-Options SAMEORIGIN,
 * X-Permitted-Cross-Domain-Policies none, X-XSS-Protection 0. */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    xContentTypeOptions: true,
  });
}

/** F-61's headers as helmet sends them (A-151), for responses written outside the hooks that
 * helmet uses: Fastify's frameworkErrors answer before any onRequest hook runs (A-178). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none';frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
};

export function applySecurityHeaders(reply: {
  header(name: string, value: string): unknown;
}): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
}

export const BODY_LIMIT = 102400;

class InvalidJsonError extends Error {
  readonly code = "BUDMON_INVALID_JSON";
}

function validationFailed(code: string, message: string) {
  return {
    defined: true,
    code: "VALIDATION_FAILED",
    status: 400,
    message: "Validation failed",
    data: { issues: [{ path: [], code, message }] },
  };
}

export function registerBodyHandling(
  app: FastifyInstance,
  deps?: { reporter: ErrorReporter; logger: Logger },
): void {
  // JSON is the only body type: no text/plain parser, and the parser's own message is never used.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string", bodyLimit: BODY_LIMIT },
    (_request, body, done) => {
      const text = typeof body === "string" ? body : body.toString("utf8");
      if (text.trim() === "") {
        done(null, undefined);
        return;
      }
      try {
        // A-152: `__proto__` keys and `constructor.prototype` are removed before validation.
        done(
          null,
          secureJson.parse(text, null, {
            protoAction: "remove",
            constructorAction: "remove",
          }) as unknown,
        );
      } catch {
        done(new InvalidJsonError("invalid json"), undefined);
      }
    },
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.code === "BUDMON_INVALID_JSON") {
      return reply
        .code(400)
        .send(validationFailed("invalid_json", "Request body is not valid JSON."));
    }
    // F-65's coarse limit (Retry-After is already set).
    if (error.code === "BUDMON_RATE_LIMITED") {
      const retryAfterSeconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      return reply.code(429).send({
        defined: true,
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many requests",
        data: { retryAfterSeconds },
      });
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({
        defined: true,
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
        message: "Payload too large",
      });
    }
    if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply
        .code(400)
        .send(validationFailed("unsupported_media_type", "Unsupported content type."));
    }
    deps?.reporter.report(error, { requestId: request.id });
    deps?.logger.error("request_failed", { errorKey: "INTERNAL", requestId: request.id }, error);
    return reply.code(500).send({
      defined: true,
      code: "INTERNAL",
      status: 500,
      message: "Internal error",
      data: { outcome: "not_applied" },
    });
  });
}
