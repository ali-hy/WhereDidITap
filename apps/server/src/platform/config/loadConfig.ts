// F-11: reads the `*_FILE`s the kind uses, validates (F-10) and returns a deep-frozen Config.
import {
  configKeysFor,
  parseConfig,
  type Config,
  type ConfigProblem,
  type ProcessKind,
  type WorkerRole,
} from "./schema.js";

export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(`Configuration invalid: ${problems.map((p) => p.variable).join(", ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof URL || value instanceof Map || value instanceof Set) return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function trimOneNewline(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function loadConfig(
  kind: ProcessKind,
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => Buffer,
): Config {
  // A-248: only the variables this kind (and these worker roles) may read; so, for example, the
  // api never reads CAPTURE_PRIVATE_KEY_FILE.
  const roles = (env["WORKER_ROLES"] ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is WorkerRole => r === "general" || r === "capture");
  const allowed = new Set(
    configKeysFor(kind, kind === "worker" && roles.length > 0 ? roles : undefined),
  );
  const scoped = Object.fromEntries(Object.entries(env).filter(([name]) => allowed.has(name)));
  // Each `*_FILE` is read when the schema asks for it, and at most once.
  const paths = new Set<string>();
  for (const [name, value] of Object.entries(scoped)) {
    if (name.endsWith("_FILE") && value !== undefined && value !== "") paths.add(value);
  }
  const cache = new Map<string, string | null>();
  const target: Record<string, string | null> = {};
  const files = new Proxy(target, {
    get(_target, key) {
      if (typeof key !== "string" || !paths.has(key)) return undefined;
      if (!cache.has(key)) {
        try {
          cache.set(key, trimOneNewline(readFile(key).toString("utf8")));
        } catch {
          cache.set(key, null);
        }
      }
      return cache.get(key);
    },
  });
  const result = parseConfig(kind, { env: scoped, files });
  if (!result.ok) {
    throw new ConfigError(result.problems);
  }
  return deepFreeze(result.config);
}

/** The text every entry point prints for a ConfigError (F-11). Names only, never values. */
export function describeConfigError(error: ConfigError): string[] {
  return ["Configuration invalid:", ...error.problems.map((p) => `  - ${p.variable}: ${p.rule}`)];
}
