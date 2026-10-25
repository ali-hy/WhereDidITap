// F-72: job payloads carry identifiers and tokens only, never user text (D-24).
export class UnsafeJobPayloadError extends Error {
  constructor(readonly path: string) {
    super(`Unsafe job payload at ${path}`);
    this.name = "UnsafeJobPayloadError";
  }
}

const SAFE_STRING = /^[A-Za-z0-9_.:+-]{1,64}$/;
const MAX_ARRAY = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && SAFE_STRING.test(value))
  );
}

/** The path of the first unsafe value in `object` (depth 1 or 2), or undefined. */
function firstUnsafe(
  object: Record<string, unknown>,
  prefix: string,
  depth: number,
): string | undefined {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isSafeScalar(value)) continue;
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) return path;
      const bad = value.findIndex((item) => !isSafeScalar(item));
      if (bad >= 0) return `${path}.${String(bad)}`;
      continue;
    }
    if (depth === 1 && isPlainObject(value)) {
      const nested = firstUnsafe(value, path, 2);
      if (nested !== undefined) return nested;
      continue;
    }
    return path;
  }
  return undefined;
}

export function assertPayloadSafe(payload: unknown): void {
  if (!isPlainObject(payload)) throw new UnsafeJobPayloadError("");
  const path = firstUnsafe(payload, "", 1);
  if (path !== undefined) throw new UnsafeJobPayloadError(path);
}
