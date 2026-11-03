// F-26: a log-safe description of a failure. Only fixed-shape tokens; the message, cause, stack
// and every other property are never read.
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const SYSTEM_CODE = /^E[A-Z0-9_]{1,30}$/;

function token(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

/** A property read that never throws; a throwing getter counts as absent (A-132). */
function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isErrorInstance(err: unknown): err is Error {
  try {
    return err instanceof Error;
  } catch {
    return false;
  }
}

export function describeFailure(err: unknown): {
  errorClass: string;
  errorCode?: string;
  reason?: string;
} {
  if (!isErrorInstance(err)) return { errorClass: "NonError" };
  let errorClass: string;
  let name: unknown;
  try {
    name = err.name;
    errorClass = token(err.constructor.name) ?? "Error";
  } catch {
    // A throwing `constructor` or `name` (A-132).
    return { errorClass: "NonError" };
  }

  let errorCode: string | undefined;
  let reason: string | undefined;
  if (name === "SchemaStepError") {
    errorCode = token(read(err, "code"));
    reason = token(read(err, "subject"));
  } else {
    const code = read(err, "code");
    if (typeof code === "string" && (SQLSTATE.test(code) || SYSTEM_CODE.test(code))) {
      errorCode = code;
    }
    // A-298: FxProviderError's reason too.
    if (
      name === "ResetRefusedError" ||
      name === "PostgresNotReadyError" ||
      name === "FxProviderError" ||
      // A-357
      name === "ObjectStoreError"
    ) {
      reason = token(read(err, "reason"));
    }
  }
  return {
    errorClass,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** `<command> failed: <errorClass>[ <errorCode>][ (<reason>)]`, for the development commands. */
export function failureLine(command: string, err: unknown): string {
  const { errorClass, errorCode, reason } = describeFailure(err);
  return `${command} failed: ${errorClass}${errorCode === undefined ? "" : ` ${errorCode}`}${reason === undefined ? "" : ` (${reason})`}`;
}

/**
 * Runs a development command (A-89): returns `fn`'s exit code (0 when it returns nothing). If `fn`
 * throws, writes exactly one `failureLine` and returns 1. Never writes a stack.
 */
export async function runCommand(
  command: string,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- LLD A-89 signature: fn may return nothing
  fn: () => Promise<number | void>,
  stderr: (line: string) => void,
): Promise<number> {
  try {
    const code = await fn();
    return typeof code === "number" ? code : 0;
  } catch (error) {
    stderr(failureLine(command, error));
    return 1;
  }
}
