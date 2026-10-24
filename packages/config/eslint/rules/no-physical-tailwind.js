// F-2: `budmon/no-physical-tailwind` (D-38). Physical Tailwind utilities break RTL layouts.

const PHYSICAL =
  /^-?(ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|^(text-left|text-right|float-left|float-right|clear-left|clear-right)$|^(border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(-|$)/;

const EXEMPT = /rtl-exempt:\s*\S/;

/** Strips `hover:`, `md:` and similar prefixes, and reports whether an `rtl:`/`ltr:` one was there. */
function split(token) {
  const parts = token.split(":");
  const base = parts.pop() ?? "";
  const directional = parts.some((p) => p === "rtl" || p === "ltr");
  return { base, directional };
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      physical: "Use the logical utility instead of '{{cls}}' (D-38).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function exempt(node) {
      const line = node.loc.start.line;
      return sourceCode
        .getAllComments()
        .some((c) => c.loc.end.line === line - 1 && EXEMPT.test(c.value));
    }

    function check(node, text) {
      if (exempt(node)) return;
      const tokens = text.split(/\s+/).filter((t) => t !== "");
      const reverse = {
        "space-x": tokens.some((t) => t.endsWith("rtl:space-x-reverse")),
        "divide-x": tokens.some((t) => t.endsWith("rtl:divide-x-reverse")),
      };
      for (const token of tokens) {
        const { base, directional } = split(token);
        if (directional) continue;
        let bad = PHYSICAL.test(base);
        // N-5: negative forms too.
        if (/^-?space-x-/.test(base) && !reverse["space-x"]) bad = true;
        if (/^-?divide-x-/.test(base) && !reverse["divide-x"]) bad = true;
        if (bad) context.report({ node, messageId: "physical", data: { cls: base } });
      }
    }

    function checkExpression(node) {
      if (node.type === "Literal" && typeof node.value === "string") {
        check(node, node.value);
      } else if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis) check(quasi, quasi.value.cooked ?? quasi.value.raw);
      } else if (node.type === "ConditionalExpression") {
        checkExpression(node.consequent);
        checkExpression(node.alternate);
      } else if (node.type === "LogicalExpression") {
        checkExpression(node.right);
      } else if (node.type === "ArrayExpression") {
        for (const el of node.elements) if (el) checkExpression(el);
      } else if (node.type === "ObjectExpression") {
        for (const prop of node.properties) {
          if (prop.type === "Property" && prop.key.type === "Literal") checkExpression(prop.key);
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "class" && node.name.name !== "classList") return;
        const value = node.value;
        if (!value) return;
        if (value.type === "Literal") checkExpression(value);
        else if (
          value.type === "JSXExpressionContainer" &&
          value.expression.type !== "JSXEmptyExpression"
        ) {
          checkExpression(value.expression);
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (node.callee.name !== "cn" && node.callee.name !== "clsx") return;
        for (const arg of node.arguments) checkExpression(arg);
      },
    };
  },
};

export default rule;
