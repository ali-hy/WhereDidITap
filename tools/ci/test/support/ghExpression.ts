// A small evaluator for GitHub Actions `if:` expressions (test-architect), enough to decide which
// workflow steps run for a given pull request: literals, the github context (dotted paths and the
// `.*.` object filter), ==, !=, !, &&, ||, parentheses, and startsWith, endsWith, contains, always,
// success, failure, cancelled. Anything else throws, so a test fails loudly instead of guessing.
export type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

type Token =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "'") {
      let s = "";
      i += 1;
      for (;;) {
        if (i >= src.length) throw new Error(`unterminated string in ${src}`);
        if (src[i] === "'" && src[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (src[i] === "'") {
          i += 1;
          break;
        } else {
          s += src.charAt(i);
          i += 1;
        }
      }
      out.push({ t: "str", v: s });
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9.]+/.exec(src.slice(i))?.[0] ?? "";
      out.push({ t: "num", v: Number(m) });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m =
        /^[A-Za-z_][A-Za-z0-9_-]*(\.(\*|[A-Za-z_][A-Za-z0-9_-]*))*/.exec(src.slice(i))?.[0] ?? "";
      out.push({ t: "id", v: m });
      i += m.length;
    } else {
      const two = src.slice(i, i + 2);
      if (["&&", "||", "==", "!="].includes(two)) {
        out.push({ t: "op", v: two });
        i += 2;
      } else if ("!(),".includes(c)) {
        out.push({ t: "op", v: c });
        i += 1;
      } else {
        throw new Error(`unsupported character ${c} in ${src}`);
      }
    }
  }
  return out;
}

function lookup(path: string, context: Value): Value {
  let current: Value[] = [context];
  let filtered = false;
  for (const part of path.split(".")) {
    if (part === "*") {
      current = current.flatMap((v) =>
        Array.isArray(v) ? v : v !== null && typeof v === "object" ? Object.values(v) : [],
      );
      filtered = true;
    } else {
      current = current.map((v) =>
        v !== null && typeof v === "object" && !Array.isArray(v) ? (v[part] ?? null) : null,
      );
    }
  }
  return filtered ? current : (current[0] ?? null);
}

const truthy = (v: Value): boolean =>
  v !== null && v !== false && v !== 0 && v !== "" && !(typeof v === "number" && Number.isNaN(v));

const str = (v: Value): string =>
  typeof v === "string"
    ? v
    : v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

const eq = (a: Value, b: Value): boolean =>
  typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;

export function evaluate(
  expression: string,
  context: Value,
  status: "success" | "failure" = "success",
): boolean {
  const src = expression.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens = tokenize(src);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const take = (v?: string): Token => {
    const tok = tokens[pos];
    if (tok === undefined || (v !== undefined && tok.v !== v)) {
      throw new Error(`expected ${v ?? "a token"} in ${src}`);
    }
    pos += 1;
    return tok;
  };
  const call = (name: string, args: Value[]): Value => {
    const a = args[0] ?? null;
    const b = args[1] ?? null;
    switch (name) {
      case "startsWith":
        return str(a).toLowerCase().startsWith(str(b).toLowerCase());
      case "endsWith":
        return str(a).toLowerCase().endsWith(str(b).toLowerCase());
      case "contains":
        return Array.isArray(a)
          ? a.some((h) => eq(h, b))
          : str(a).toLowerCase().includes(str(b).toLowerCase());
      case "always":
        return true;
      case "success":
        return status === "success";
      case "failure":
        return status === "failure";
      case "cancelled":
        return false;
      default:
        throw new Error(`unsupported function ${name} in ${src}`);
    }
  };
  const primary = (): Value => {
    const tok = take();
    if (tok.t === "str" || tok.t === "num") return tok.v;
    if (tok.t === "op" && tok.v === "(") {
      const v = or();
      take(")");
      return v;
    }
    if (tok.t === "op" && tok.v === "!") return !truthy(primary());
    if (tok.t === "id") {
      if (tok.v === "true") return true;
      if (tok.v === "false") return false;
      if (tok.v === "null") return null;
      if (peek()?.v === "(") {
        take("(");
        const args: Value[] = [];
        while (peek()?.v !== ")") {
          args.push(or());
          if (peek()?.v === ",") take(",");
        }
        take(")");
        return call(tok.v, args);
      }
      return lookup(tok.v, context);
    }
    throw new Error(`unexpected ${tok.v} in ${src}`);
  };
  const comparison = (): Value => {
    let left = primary();
    while (peek()?.v === "==" || peek()?.v === "!=") {
      const op = take().v;
      const right = primary();
      left = op === "==" ? eq(left, right) : !eq(left, right);
    }
    return left;
  };
  const and = (): Value => {
    let left = comparison();
    while (peek()?.v === "&&") {
      take();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = (): Value => {
    let left = and();
    while (peek()?.v === "||") {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const result = or();
  if (pos !== tokens.length) throw new Error(`trailing tokens in ${src}`);
  return truthy(result);
}

/** The value an expression evaluates to (for `${{ a && 'x' || 'y' }}` forms). */
export function evaluateValue(expression: string, context: Value): string {
  for (const candidate of ["migrate", "push"]) {
    if (
      evaluate(
        `(${expression.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")}) == '${candidate}'`,
        context,
      )
    ) {
      return candidate;
    }
  }
  return "";
}

/** The github context of a pull_request event. */
export function pullRequestContext(opts: {
  headRef: string;
  baseRef?: string;
  labels?: readonly string[];
  merged?: boolean;
  action?: string;
}): Value {
  return {
    github: {
      event_name: "pull_request",
      head_ref: opts.headRef,
      base_ref: opts.baseRef ?? "main",
      ref: "refs/pull/1/merge",
      event: {
        action: opts.action ?? "synchronize",
        pull_request: {
          merged: opts.merged ?? false,
          head: { ref: opts.headRef },
          base: { ref: opts.baseRef ?? "main" },
          labels: (opts.labels ?? []).map((name) => ({ name })),
        },
      },
    },
  };
}
